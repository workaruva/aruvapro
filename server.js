const socket = io();
const pcMap = new Map();
let localStream;
let myId = '';
let currentRoom = '';
let isMicOn = false;
let audioContext = null;
// УДАЛИТЬ эту строку: let audioProcessor = null;
let audioSource = null;
let audioDestination = null;

// Элементы DOM
const lobby = document.getElementById('lobby');
const room = document.getElementById('room');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const leaveBtn = document.getElementById('leaveBtn');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const participants = document.getElementById('participants');
const audioContainer = document.getElementById('audio-container');
const myIdDisplay = document.getElementById('myId');
const lobbyError = document.getElementById('lobby-error');
const micToggleBtn = document.getElementById('micToggleBtn');
const usernameInput = document.getElementById('usernameInput');
const micStatus = document.getElementById('micStatus');
const approvalModal = document.getElementById('approval-modal');
const approvalMessage = document.getElementById('approval-message');
const approveBtn = document.getElementById('approve-btn');
const rejectBtn = document.getElementById('reject-btn');
const applyAudioSettings = document.getElementById('applyAudioSettings');

// Audio settings elements
const noiseSuppressionCheckbox = document.getElementById('noiseSuppression');
const echoCancellationCheckbox = document.getElementById('echoCancellation');
const autoGainControlCheckbox = document.getElementById('autoGainControl');
const highQualityCheckbox = document.getElementById('highQuality');
const roomNoiseSuppression = document.getElementById('roomNoiseSuppression');
const roomEchoCancellation = document.getElementById('roomEchoCancellation');

let approvalQueue = [];
let isProcessingApproval = false;

// Enhanced audio processing with Web Audio API
class AudioProcessor {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.destination = null;
        this.processor = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.audioContext.resume();
            this.isInitialized = true;
        } catch (error) {
            console.warn('Web Audio API not supported:', error);
        }
    }

    async createProcessedAudioStream(originalStream) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.audioContext) {
            return originalStream;
        }

        try {
            // Close previous connections if they exist
            if (this.source) {
                this.source.disconnect();
            }

            this.source = this.audioContext.createMediaStreamSource(originalStream);
            this.destination = this.audioContext.createMediaStreamDestination();

            // Create audio processing nodes
            const highPassFilter = this.audioContext.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 100; // Remove low-frequency rumble

            const lowPassFilter = this.audioContext.createBiquadFilter();
            lowPassFilter.type = 'lowpass';
            lowPassFilter.frequency.value = 7000; // Remove high-frequency noise

            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -20;
            compressor.knee.value = 10;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.01;
            compressor.release.value = 0.1;

            // Connect processing chain based on settings
            this.source.connect(highPassFilter);
            
            if (noiseSuppressionCheckbox.checked) {
                highPassFilter.connect(lowPassFilter);
                lowPassFilter.connect(compressor);
            } else {
                highPassFilter.connect(compressor);
            }
            
            compressor.connect(this.destination);

            console.log('Audio processing activated');
            return this.destination.stream;

        } catch (error) {
            console.warn('Audio processing failed, using original stream:', error);
            return originalStream;
        }
    }

    async updateAudioSettings() {
        if (this.source && this.destination) {
            // Recreate processing chain with new settings
            this.source.disconnect();
            return this.createProcessedAudioStream(localStream);
        }
    }

    async close() {
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
            this.isInitialized = false;
        }
    }
}

// СОЗДАЕМ ТОЛЬКО ОДИН ЭКЗЕМПЛЯР AudioProcessor
const audioProcessor = new AudioProcessor();

// Enhanced media stream with better constraints
async function getMediaStreamWithSettings() {
    const constraints = {
        audio: {
            noiseSuppression: noiseSuppressionCheckbox.checked,
            echoCancellation: echoCancellationCheckbox.checked,
            autoGainControl: autoGainControlCheckbox.checked,
            channelCount: 1,
            sampleRate: highQualityCheckbox.checked ? 48000 : 24000,
            sampleSize: 16,
            latency: 0.01,
            // Advanced constraints for better quality
            googEchoCancellation: echoCancellationCheckbox.checked,
            googAutoGainControl: autoGainControlCheckbox.checked,
            googNoiseSuppression: noiseSuppressionCheckbox.checked,
            googHighpassFilter: true,
            googAudioMirroring: false
        },
        video: false
    };

    console.log('Requesting media with constraints:', constraints);

    try {
        let stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Apply additional Web Audio API processing
        if (noiseSuppressionCheckbox.checked) {
            stream = await audioProcessor.createProcessedAudioStream(stream);
        }
        
        return stream;
    } catch (err) {
        console.error('Error accessing media with constraints:', err);
        
        // Fallback strategies
        try {
            // Try with basic constraints
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    noiseSuppression: true,
                    echoCancellation: true
                }, 
                video: false 
            });
            console.log('Using fallback audio settings');
            return fallbackStream;
        } catch (fallbackErr) {
            console.error('Fallback also failed:', fallbackErr);
            
            // Last resort - basic audio
            try {
                const basicStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: true, 
                    video: false 
                });
                console.log('Using basic audio without processing');
                return basicStream;
            } catch (finalErr) {
                console.error('All audio access attempts failed:', finalErr);
                throw finalErr;
            }
        }
    }
}

async function updateAudioSettings() {
    if (!localStream) return;

    const wasMicOn = isMicOn;
    
    // Stop current tracks
    localStream.getTracks().forEach(track => track.stop());
    
    // Close audio processor to reinitialize
    await audioProcessor.close();

    try {
        // Get new stream with updated settings
        localStream = await getMediaStreamWithSettings();
        
        // Update all peer connections with new stream
        pcMap.forEach((pc, peerId) => {
            const senders = pc.getSenders();
            const audioTrack = localStream.getAudioTracks()[0];
            
            const audioSender = senders.find(sender => 
                sender.track && sender.track.kind === 'audio'
            );
            
            if (audioSender && audioTrack) {
                audioSender.replaceTrack(audioTrack).catch(err => {
                    console.warn('Could not replace track for peer:', peerId, err);
                });
            }
        });

        // Restore mic state
        localStream.getTracks().forEach(track => {
            track.enabled = wasMicOn;
        });

        console.log('Audio settings updated successfully');
        showNotification('Audio settings updated', 'success');

    } catch (err) {
        console.error('Error updating audio settings:', err);
        showNotification('Failed to update audio settings', 'error');
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 p-4 rounded-md shadow-lg z-50 ${
        type === 'success' ? 'bg-green-500' : 
        type === 'error' ? 'bg-red-500' : 'bg-blue-500'
    } text-white`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

async function init() {
    try {
        localStream = await getMediaStreamWithSettings();
        localStream.getTracks().forEach(track => track.enabled = false);
        myId = socket.id;
        myIdDisplay.textContent = myId;
        addParticipantCard(myId, true, usernameInput.value);
        
        // Test audio quality
        await testAudioQuality();
        
    } catch (err) {
        console.error('Microphone access error:', err);
        lobbyError.textContent = 'Microphone access is required to use this app. Please allow microphone access and refresh the page.';
        joinBtn.disabled = true;
    }
}

async function testAudioQuality() {
    // Simple audio quality test
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            const settings = audioTrack.getSettings();
            console.log('Audio settings applied:', {
                sampleRate: settings.sampleRate,
                channelCount: settings.channelCount,
                noiseSuppression: settings.noiseSuppression,
                echoCancellation: settings.echoCancellation,
                autoGainControl: settings.autoGainControl
            });
        }
    }
}

function toggleMic(state) {
    if (!localStream) return;
    
    isMicOn = state;
    localStream.getTracks().forEach(track => track.enabled = isMicOn);
    
    // Update UI
    micToggleBtn.textContent = isMicOn ? "🔇 Mute" : "🎤 Unmute";
    micToggleBtn.classList.toggle('bg-indigo-500', isMicOn);
    micToggleBtn.classList.toggle('bg-gray-600', !isMicOn);
    
    micStatus.textContent = isMicOn ? "You are talking..." : "Hold 'M' to talk or use button";
    micStatus.className = isMicOn ? 'text-green-400 text-center' : 'text-gray-400 text-center';
    
    updateSpeakingStatus(myId, isMicOn);
    socket.emit('speaking', { roomID: currentRoom, speaking: isMicOn });
}

// Event listeners
micToggleBtn.addEventListener('click', () => toggleMic(!isMicOn));

// Keyboard controls with better handling
let isKeyPressed = false;
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm' && !isKeyPressed && 
        document.activeElement !== roomInput && 
        document.activeElement !== usernameInput) {
        isKeyPressed = true;
        if (!isMicOn) {
            toggleMic(true);
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'm' && isKeyPressed) {
        isKeyPressed = false;
        toggleMic(false);
    }
});

// Apply audio settings button
applyAudioSettings.addEventListener('click', updateAudioSettings);

// Sync lobby and room audio settings in real-time
roomNoiseSuppression.addEventListener('change', () => {
    noiseSuppressionCheckbox.checked = roomNoiseSuppression.checked;
});

roomEchoCancellation.addEventListener('change', () => {
    echoCancellationCheckbox.checked = roomEchoCancellation.checked;
});

// Approval queue management
function processApprovalQueue() {
    if (isProcessingApproval || approvalQueue.length === 0) return;
    isProcessingApproval = true;

    const { guestId, username, roomID } = approvalQueue.shift();
    approvalMessage.textContent = `User "${username || 'Guest'}" wants to join.`;
    approvalModal.classList.remove('hidden');

    const handleApproval = (accept) => {
        socket.emit('approve-user', { roomID, guestId, accept });
        approvalModal.classList.add('hidden');
        isProcessingApproval = false;
        processApprovalQueue();
    };

    approveBtn.onclick = () => handleApproval(true);
    rejectBtn.onclick = () => handleApproval(false);
}

// Room management
joinBtn.addEventListener('click', () => {
    const code = roomInput.value.trim().toUpperCase();
    const username = usernameInput.value.trim();
    
    if (code.length < 4) {
        lobbyError.textContent = 'Room code must be at least 4 characters.';
        return;
    }
    if (!username) {
        lobbyError.textContent = 'Please enter your name.';
        return;
    }
    
    addParticipantCard(myId, true, username);
    lobby.classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    socket.emit('join', { roomID: code, username });
    currentRoom = code;
});

leaveBtn.addEventListener('click', () => {
    // Clean up audio resources
    audioProcessor.close();
    
    // Stop all media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    socket.emit('leave', currentRoom);
    showLobby();
});

function showRoom(code) {
    document.getElementById('loading-screen').classList.add('hidden');
    lobby.classList.add('hidden');
    room.classList.remove('hidden');
    roomCodeDisplay.textContent = code;
}

function showLobby() {
    lobby.classList.remove('hidden');
    room.classList.add('hidden');
    participants.innerHTML = '';
    audioContainer.innerHTML = '';
    
    // Close all peer connections
    pcMap.forEach(pc => pc.close());
    pcMap.clear();
    
    currentRoom = '';
    lobbyError.textContent = '';
    toggleMic(false);
    
    if (myId) {
        addParticipantCard(myId, true, usernameInput.value);
    }
}

function addParticipantCard(id, isSelf = false, username = '') {
    const existingCard = document.getElementById(`participant-${id}`);
    if (existingCard) {
        existingCard.querySelector('p').textContent = isSelf
            ? `You (${username || 'Me'})`
            : `${username || 'Guest'} (${id.substring(0, 4)})`;
        return;
    }

    const card = document.createElement('div');
    card.id = `participant-${id}`;
    card.className = 'bg-gray-700 p-4 rounded-lg flex items-center space-x-3';

    const ring = document.createElement('div');
    ring.className = `w-4 h-4 rounded-full ${isSelf ? 'bg-blue-400' : 'bg-gray-500'}`;
    ring.id = `status-ring-${id}`;

    const name = document.createElement('p');
    name.className = 'font-medium truncate';
    name.textContent = isSelf
        ? `You (${username || 'Me'})`
        : `${username || 'Guest'} (${id.substring(0, 4)})`;
    
    card.appendChild(ring);
    card.appendChild(name);
    participants.appendChild(card);
}

function removeParticipantCard(id) {
    const card = document.getElementById(`participant-${id}`);
    if (card) card.remove();
}

function updateSpeakingStatus(id, isSpeaking) {
    const ring = document.getElementById(`status-ring-${id}`);
    if (ring) {
        if (isSpeaking) {
            ring.classList.add('ring-pulse', 'bg-green-400');
            ring.classList.remove('bg-gray-500', 'bg-blue-400');
        } else {
            ring.classList.remove('ring-pulse', 'bg-green-400');
            const isSelf = document.getElementById(`participant-${id}`).textContent.startsWith('You');
            ring.classList.add(isSelf ? 'bg-blue-400' : 'bg-gray-500');
        }
    }
}

// Socket event handlers
socket.on('connect', init);

socket.on('room-created', (code) => showRoom(code));

socket.on('join-accepted', ({ roomID, existingUsers, usernames }) => {
    showRoom(roomID);
    existingUsers.forEach(id => {
        addParticipantCard(id, false, usernames[id]);
        createPeerConnection(id, true);
    });
});

socket.on('approval-request', ({ guestId, username, roomID }) => {
    approvalQueue.push({ guestId, username, roomID });
    processApprovalQueue();
});

socket.on('new-user', ({ id, username }) => {
    addParticipantCard(id, false, username);
});

socket.on('user-disconnected', (userId) => {
    const pc = pcMap.get(userId);
    if (pc) {
        pc.close();
        pcMap.delete(userId);
    }
    removeParticipantCard(userId);
    const audioEl = document.getElementById(`audio-${userId}`);
    if (audioEl) audioEl.remove();
});

socket.on('room-full', () => {
    document.getElementById('loading-screen').classList.add('hidden');
    lobby.classList.remove('hidden');
    lobbyError.textContent = 'Sorry, that room is full (max 4 users).';
});

socket.on('join-rejected', () => {
    document.getElementById('loading-screen').classList.add('hidden');
    lobby.classList.remove('hidden');
    lobbyError.textContent = 'Your request to join was rejected.';
});

socket.on('user-speaking', ({ userId, speaking }) => {
    updateSpeakingStatus(userId, speaking);
});

// WebRTC functions
async function createPeerConnection(peerId, isOfferer) {
    if (!localStream) return;
    
    const pc = new RTCPeerConnection({ 
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ] 
    });
    
    pcMap.set(peerId, pc);
    
    // Add all audio tracks
    localStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: peerId, candidate: event.candidate });
        }
    };
    
    pc.ontrack = (event) => {
        let audioEl = document.getElementById(`audio-${peerId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${peerId}`;
            audioEl.autoplay = true;
            audioEl.controls = false;
            audioEl.style.display = 'none'; // Hide but keep functional
            audioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };
    
    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
    };
    
    if (isOfferer) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: peerId, sdp: pc.localDescription });
        } catch (err) {
            console.error('Error creating offer:', err);
        }
    }
}

socket.on('offer', async ({ caller, sdp }) => {
    await createPeerConnection(caller, false);
    const pc = pcMap.get(caller);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: caller, sdp: pc.localDescription });
});

socket.on('answer', async ({ callee, sdp }) => {
    const pc = pcMap.get(callee);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on('ice-candidate', async ({ sender, candidate }) => {
    const pc = pcMap.get(sender);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});
