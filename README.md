**Swedish Multiplayer Quiz Game**

This project is a multiplayer quiz game entirely in Swedish. The game is hosted on a Node.js server, leveraging Express.js and Socket.IO to create a real-time, interactive experience for players on the same local network.

Players can join the same game and compete against each other by answering quiz questions.
Currently the game and all its content is in Swedish.
Players can create or join existing games, select avatars, and choose usernames.
Players earn points for correct answers and can gain streak bonuses for consecutive correct answers.
First player to reach 20 points wins.

---------------

**How To Run**

Clone the repository to your local machine.
Ensure you have Node.js installed.
Run "npm install" to install the required dependencies.
Start the server by running node server.js.
The server will start on port 3000.

The user who starts the server can join the game by navigating to http://localhost:3000 in their browser.
Other players on the same local network can connect by entering the local IP adress http://XX.XXX.XX.XX:3000 into their browsers.
Check your IP address in Command Prompt window by writing "ipconfig".
Look for the section under "Ethernet adapter" and find the IPv4 Address.

---------------

**Next Steps**

To take this game to the next level, consider the following improvements.

Introduce a database to handle game sessions, player accounts, and results.
Implement leaderboards where players can view the top performers in various categories.
Allow users to create accounts and track their progress over time.
Expand the game with different categories, gamemodes and achievements.
Create a temporary gamechat for each game.

Two known issues exist where players can currently answer correctly multiple times in a row on the same question.
When a game is full, spectators cannot view other players' inputs, which should be resolved for a better user experience.
