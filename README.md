# multi-voice-chat
A mini project about multi-user voice-chat for browsers, made using WebRTC and Socket.IO.

## How it works
1. Open the site via this [link](https://multi-voice-chat.onrender.com) or locally.
2. Allow microphone access permission for voice chat.
3. If you are creating a room, enter a custom code of your choice, 4-6 characters long.
4. Share this code with your friends and see all joining requests in lobby.
5. The mic is muted by default, hold 'M' or press unmute button to temporarily unmute yourself when speaking.
6. If the host gets disconnected, the first guest who joined the room becomes the host.
7. If everybody leaves the room, it becomes empty and the connection is closed.
8. Upto 4 members can join a Room.

## Quick set up
1. Clone this repository and navigate to the folder:
```sh
git clone https://github.com/siddhantv1/multi-voice-chat.git
cd multi-voice-chat
```
2. Install dependencies
```sh
npm install
```

3. Run the server and then open `http://localhost:3000` 
```sh
node server.js
```
### Tech Stack
- frontend, server: HTML-CSS, Javascript
- communication: SocketIO WebRTC

**Deployment Link:** 
[Render](https://multi-voice-chat.onrender.com)
