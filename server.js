const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
//serve index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const rooms = {}; //store rooms
const usernames = {}; // <-- store usernames

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join', ({ roomID, username }) => { //create or join a room
        if (!rooms[roomID]) {
            rooms[roomID] = {
                members: [],
                pending: new Set(),
                host: socket.id
            };
        }
        //usernames or socket ID as names
        usernames[socket.id] = username || socket.id;

        const room = rooms[roomID];
        //room max-capacity
        if (room.members.length >= 4) {
            return socket.emit('room-full');
        }

        if (room.members.length === 0) {
            room.members.push(socket.id);
            socket.join(roomID);
            socket.emit('room-created', roomID);
            console.log(`Room ${roomID} created by host ${socket.id}`);
        } else {
            room.pending.add(socket.id);
            //fix: guest name appears on request
            io.to(room.host).emit('approval-request', {
                guestId: socket.id,
                username: usernames[socket.id], // Send username to the host
                roomID
            });
            console.log(`User ${socket.id} (${usernames[socket.id]}) requesting to join room ${roomID}`);
        }
    });

    // host: reject or accept request to join
    socket.on('approve-user', ({ roomID, guestId, accept }) => {
        const room = rooms[roomID];
        if (!room || socket.id !== room.host) return;

        // remove guest from lobby.
        room.pending.delete(guestId);

        if (accept) {
            // Check room capacity
            if (room.members.length >= 4) {
                io.to(guestId).emit('room-full');
                return;
            }

            //notify host+ other guests of new member connected
            io.to(roomID).emit('new-user', {
                id: guestId,
                username: usernames[guestId] || guestId
            });

            // Add the member
            room.members.push(guestId);
            
            //initiate webRTC connections with members list
            io.to(guestId).emit('join-accepted', {
                roomID,
                existingUsers: room.members.filter(id => id !== guestId),
                usernames: room.members.reduce((acc, id) => {
                    acc[id] = usernames[id] || id; // Provide a map of all usernames
                    return acc;
                }, {})
            });

            // add the guest's socket to the Socket.IO room
            const guestSocket = io.sockets.sockets.get(guestId);
            if (guestSocket) guestSocket.join(roomID);

            console.log(`User ${guestId} approved for room ${roomID}`);
        } else {
            io.to(guestId).emit('join-rejected');
            console.log(`User ${guestId} rejected for room ${roomID}`); //rejection
        }
    });

    // forward connection from peer to peer
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { sdp: data.sdp, caller: socket.id });
    });

    // return answer connection back to caller
    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { sdp: data.sdp, callee: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
    });
    socket.on('speaking', ({ roomID, speaking }) => {
        socket.to(roomID).emit('user-speaking', { userId: socket.id, speaking });
    });

    //handle disconnnects or leavs
    const handleDisconnect = () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomID in rooms) {
            const room = rooms[roomID];
            const memberIndex = room.members.indexOf(socket.id);

            if (memberIndex > -1) {
                room.members.splice(memberIndex, 1);
                // terminal notify that member left
                socket.to(roomID).emit('user-disconnected', socket.id);
                delete usernames[socket.id];

                // assign a new host
                if (socket.id === room.host && room.members.length > 0) {
                    room.host = room.members[0];
                    io.to(room.host).emit('new-host');
                    console.log(`New host for room ${roomID} is ${room.host}`);
                }

                // If the room is now empty, close connection
                if (room.members.length === 0) {
                    delete rooms[roomID];
                    console.log(`Room ${roomID} is now empty and has been closed.`);
                }
                break;
            }
            //remove pending requests
            room.pending.delete(socket.id);
        }
    };
    socket.on('leave', (roomID) => {
        handleDisconnect();
    });    
    socket.on('disconnect', () => {
        handleDisconnect();
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
