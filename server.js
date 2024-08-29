const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
io.to = (function(to_orignal) {
    to_orignal = to_orignal.bind(io);
    return function(gameId) {
        // console.log(to_orignal);
        const to_result = to_orignal(gameId);
        // console.log(to_result);
        if(!to_result.detour && gameId && games[gameId])
        {
            const game = games[gameId];
            to_result.detour = true;
            to_result.emit = (function(emit_original) {
                emit_original = emit_original.bind(to_result);
                return (name, args) => {
                   emit_original(name, args); 
                   game.log(name, args);
                }
            })(to_result.emit);
        }
        return to_result;
    }
})(io.to);
const games = {};
app.use(express.static(__dirname + '/public'));
app.use(express.json());

const questions = require('./public/questions.json');
const QUESTION_TIMEOUT = 20000; // 20 seconds for each question

function updateGamesList(socket) {
  // Create an array of active games with the necessary details
  const gamesList = Object.values(games).map(game => ({
    name: game.name,
    players: game.users.length,
    maxPlayers: game.maxPlayers,
    hasPassword: !!game.password,
    gameCode: game.gameCode,
    gameInProgress: game.gameInProgress,
  }));
  if(socket)
  {
    socket.emit('updateGamesList', gamesList); 
  }
  else
  {
    // Emit the updated games list to all connected clients
    io.emit('updateGamesList', gamesList);
  }
}

io.on('connection', (socket) => {
  console.log('A user connected');
  updateGamesList(socket);
  socket.on('requestJoinGameWithPassword', ({gameId, password}) => {
    const game = games[gameId];
    if(game && game.password == password) {
      socket.emit('pass');
    }
  })
  socket.on('joinGame', ({ gameId, username, avatar }) => {
    let game = games[gameId];
    if (game) {
      socket.join(gameId); // Join the room for this game
      socket.gameCode = gameId; // Assign the game code to the socket
      game.addPlayer(socket, username, avatar); // Add the player to the game
      updateGamesList();
      io.to(gameId).emit('updateUserList', game.users); // Notify all clients in this game
    }
  });
  socket.on('spectateGame', ({gameId}) => {
      let game = games[gameId]
      if(game && !game.password) {
          socket.join(gameId);
          socket.gameCode = gameId;
          socket.emit('updateUserList', game.users);
          for (const ev of game.loggedMsgs)
          {
              if(ev[0] == 'message' || ev[0] == 'startGame' || ev[0] == 'countdown')
              {
                  socket.emit(ev[0], ev[1]);
              }
          }
      }
  });
  socket.on('userReady', (username) => { // Listen for 'userReady' event
    const game = games[socket.gameCode]; // Get the game object using gameCode
    if (!game) {
      console.error('Game not found for code:', socket.gameCode);
      return;
    }
    const userIndex = game.users.findIndex(user => user.username === username);
    if (userIndex !== -1) {
      game.users[userIndex].ready = true; // Set this user's 'ready' property to true
    }
    io.to(socket.gameCode).emit('updateUserList', game.users); // Emit the updated users list

    // If all users are ready, start the game
    if (game.users.every(user => user.ready)) { // Check if all users are ready
      game.gameInProgress = true;
      updateGamesList();
      io.to(socket.gameCode).emit('startGame'); // Emit the startGame event
      io.to(socket.gameCode).emit('message', { username: 'Bot', message: 'Spelet börjar strax. Först till 20 vinner!' });
      setTimeout(() => {
        game.loadQuestionsAndStart();
      }, 3000);
    }
  });

  socket.on('submitAnswer', ({ gameId, data }) => {
    let game = games[gameId];
    if (game && game.gameInProgress) {
      game.processAnswer(socket, data);
    }
    if (game.gameInProgress &&
      game.currentQuestion <= game.questions.length &&
      game.userAttempts[data.username] > 0 &&
      !game.correctAnsweredUsers[data.username]) {

      const question = game.questions[game.currentQuestion - 1];
      const userAnswer = data.answer.toLowerCase().trim();
      const correctAnswers = question.answer.map(answer => answer.toLowerCase().trim());
      const userIndex = games[socket.gameCode].users.findIndex(user => user.username === data.username);
      const timeTaken = Date.now() - game.questionStartTime;

      if (correctAnswers.includes(userAnswer)) {
        game.userLastAnswerTime[data.username] = Date.now();
        if (userIndex !== -1) {
          const position = game.correctAnsweredCount + 1;
          const score = game.answerScores[position - 1] || 0;
          game.users[userIndex].score += score;
          correctAnswers.forEach(answer => game.correctAnsweredUsers[answer] = true);
          game.correctAnsweredCount++;

          if (timeTaken <= 5000) {
            game.userStreaks[data.username] = (game.userStreaks[data.username] || 0) + 1;

            if (game.userStreaks[data.username] === 3) {
              io.to(gameId).emit('message', {
                username: 'Bot',
                message: `${data.username} är on fire! <img src="/fire.gif" alt="Fire" class="fire-icon">`
              });
              game.users[userIndex].isOnFire = true;
            } else if (game.userStreaks[data.username] === 5) {
              io.to(gameId).emit('message', {
                username: 'Bot',
                message: `${data.username} är HELT GALEN! <img src="/blazing.gif" alt="Fire" class="fire-icon">`
              });
              game.users[userIndex].isOnFire = false;  // Reset the on-fire status
              game.users[userIndex].isBlazing = true;  // Set the blazing status
              game.userStreaks[data.username] = 0;  // Reset the streak
            }
          } else {
            game.resetStreak(data.username, userIndex);
          }

          if (game.users[userIndex].score >= 20) {
            io.to(gameId).emit('gameWon', { username: game.users[userIndex].username, avatar: game.users[userIndex].avatar, score: game.users[userIndex].score });
          }

          game.sendPointsFeedback(data.username, score);

          io.to(gameId).emit('updateUserList', game.users);

          if (game.correctAnsweredCount === game.users.length) {
            clearTimeout(game.questionTimer);
            io.to(gameId).emit('allUsersAnsweredCorrectly');  // Emit the new event
            setTimeout(() => {
              io.to(gameId).emit('message', { username: 'Bot', message: 'Bra jobbat! Nästa fråga kommer om...' });
              setTimeout(() => {
                game.askQuestion();
              }, 3000);
            }, 1000);
          }
        }
      } else {
        game.userStreaks[data.username] = 0;  // Reset the streak if the answer is wrong
        game.userAttempts[data.username]--;
        if (game.userAttempts[data.username] > 0) {
          socket.emit('message', { username: 'Bot', message: `Fel! ${game.userAttempts[data.username]} försök kvar.` });
        } else {
          socket.emit('message', { username: 'Bot', message: 'Inga fler försök kvar på denna fråga.' });
          if (!game.correctAnsweredUsers[data.username]) {
            game.finishedAnsweringCount++;  // Increment the new counter here
          }
          game.users[userIndex].isOnFire = false; // Set the user's on-fire status to false only when no attempts are left.
        }

        io.to(gameId).emit('updateUserList', game.users);  // Emit the updated user list to reflect the removed streak/fire icon
      }
    }

  });
  socket.on('disconnect', () => {
    console.log('A user disconnected');
    const gameCode = socket.gameCode;
    if (gameCode && games[gameCode]) {
      const game = games[gameCode];
      const index = game.users.findIndex((user) => user.id === socket.id);
      if (index !== -1) {
        game.users.splice(index, 1);
      }
      if (game.users.length === 0) {
          if(game.gameInProgress)
          {
            delete games[gameCode];
          }
          else {
            setTimeout(() => {
              if (games[gameCode] && games[gameCode].users.length === 0) {
                delete games[gameCode];
                updateGamesList();  
              }
            }, 300000); // 5 minutes delay before deleting the game
        }
      }
    }
    updateGamesList();
  });
});
class User {
  constructor(name, avatar, id) {
    this.avatar = avatar;
    this.username = name;
    this.id = id;
    this.score = 0;
    this.isOnFire = false;
    this.isBlazing = false;
  }
}
class Game {
  constructor(name, maxPlayers, password) {
    this.name = name; // Name of the game
    this.maxPlayers = maxPlayers; // Maximum number of players allowed
    this.password = password; // Password for the game (if any)
    this.gameCode = this.generateGameId(); // Game code (assuming you have a method to generate it)
    this.users = [];
    this.currentQuestion = 0;
    this.gameInProgress = false;
    this.userAttempts = {};
    this.questionTimer;
    this.answerScores = [3, 2, 1];
    this.correctAnswers = [];
    this.correctAnsweredUsers = {};
    this.userLastAnswerTime = {};
    this.correctAnsweredCount = 0;
    this.finishedAnsweringCount = 0;
    this.userStreaks = {};
    this.questionStartTime = null;
    this.loggedMsgs = [];
  }
  log(name, args) {
      this.loggedMsgs.push([name, args]);
  }
  addPlayer(socket, username, avatar) {
    // Add the player to this game
    this.users.push(new User(username, avatar, socket.id));
    this.userAttempts[username] = 0;
  }
  
  processAnswer(socket, data) {

  }

  generateGameId() {
    let gameCode = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 6; i++) {
      gameCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    // Ensure the gameCode is unique
    while (Object.values(games).some(game => game.gameCode === gameCode)) {
      gameCode = '';
      for (let i = 0; i < 6; i++) {
        gameCode += characters.charAt(Math.floor(Math.random() * characters.length));
      }
    }
    return gameCode;
  }

  loadQuestionsAndStart() {
    this.currentQuestion = 0;
    this.shuffleQuestions();
    this.askQuestion();
  }

  shuffleQuestions() {
    this.questions = questions.slice();
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
  }

  startCountdown(gameId) {
    io.to(gameId).emit('countdown', { count: 3 });
    setTimeout(() => {
      io.to(gameId).emit('countdown', { count: 2 });
      setTimeout(() => {
        io.to(gameId).emit('countdown', { count: 1 });
      }, 1000);
    }, 1000);
  }

  resetStreak(username, userIndex) {
    this.userStreaks[username] = 0;
    this.users[userIndex].isOnFire = false;
    this.users[userIndex].isBlazing = false;
  }

  getCorrectAnswerText(answers) {
    if (!answers || answers.length === 0) {
      return '';
    }

    if (answers.length === 1) {
      return answers[0];
    }

    // Find the longest correct answer
    let longestAnswer = answers[0];
    for (let i = 1; i < answers.length; i++) {
      if (answers[i].length > longestAnswer.length) {
        longestAnswer = answers[i];
      }
    }

    return longestAnswer;
  }

  sendPointsFeedback(username, points) {
    io.to(this.gameCode).emit('message', { username: 'Bot', message: `${username} svarade rätt och fick ${points} poäng!` });
  }

  askQuestion() {
    if (this.currentQuestion < this.questions.length) {
      this.correctAnswers = [];
      this.correctAnsweredUsers = {};
      this.correctAnsweredCount = 0; // Reset the count
      const question = this.questions[this.currentQuestion++];
      for (const user in this.userAttempts) {
        this.userAttempts[user] = 3;
      }
      this.startCountdown(this.gameCode);
      const currentTime = Date.now();
      for (let user of this.users) {
        if (user.isOnFire && (currentTime - (this.userLastAnswerTime[user.username] || 0) > 5000)) {
          user.isOnFire = false;
        }
      }
      io.to(this.gameCode).emit('updateUserList', this.users);

      setTimeout(() => {
        this.questionStartTime = Date.now();
        io.to(this.gameCode).emit('question', {
          username: 'Bot',
          questionNumber: this.currentQuestion,
          question: question.question,
          correctAnswerText: this.getCorrectAnswerText(question.answer)
        });
        console.log(question.answer);
        setTimeout(() => {
          const currentTime = Date.now();
          for (let user of this.users) {
            if ((currentTime - (this.userLastAnswerTime[user.username] || 0) > 5000)) {
              this.resetStreak(user.username, this.users.findIndex(u => u.username === user.username));
            }
          }
          io.to(this.gameCode).emit('updateUserList', this.users);
        }, 5000);
        if (this.questionTimer) {
          clearTimeout(this.questionTimer);
        }
        this.questionTimer = setTimeout(() => {
          io.to(this.gameCode).emit('message', { username: 'Bot', message: `Tiden är ute! Rätt svar är ${this.getCorrectAnswerText(question.answer)}. Nästa fråga om...` });
          setTimeout(() => {
            this.askQuestion();
          }, 3000);
        }, QUESTION_TIMEOUT);
        io.to(this.gameCode).emit('scrollChatToBottom');
      }, 4000);
    } else {
      this.gameInProgress = false;
      io.to(this.gameCode).emit('message', { username: 'Bot', message: 'Inga fler frågor. Tack för att du spelade!' });
    }
  }

}

app.post('/create', (req, res) => {
  const { name, maxPlayers, password } = req.body;
  let game = new Game(name, maxPlayers, password);
  const gameId = game.gameCode;
  games[gameId] = game;
  updateGamesList();
  res.json({ gameId: gameId });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
