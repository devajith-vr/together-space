

document.addEventListener('DOMContentLoaded', () => {

    let currentRoomCode = null;
    let currentUserName = null;
    let isCreator = false;
    let timerTickInterval = null;


    let mqttClient = null;
    let roomCryptoKey = null;
    let roomTopic = null;
    let lastPartnerActiveTime = 0;
    let isPartnerOnline = false;

    let plyrPlayer = null;
    let isIncomingSync = false;

    // Initialize Plyr Media Player
    plyrPlayer = new Plyr('#mainVideo', {
        controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
        seekTime: 10
    });

    // UI Screen References
    const loginScreen = document.getElementById('loginScreen');
    const appScreen = document.getElementById('app');
    
    const loginStep1 = document.getElementById('loginStep1');
    const loginCreateForm = document.getElementById('loginCreateForm');
    const loginRoomCreated = document.getElementById('loginRoomCreated');
    const loginJoinForm = document.getElementById('loginJoinForm');

    const btnShowCreate = document.getElementById('btnShowCreate');
    const btnShowJoin = document.getElementById('btnShowJoin');
    const backBtns = document.querySelectorAll('.btn-back');
    const headerRoomBadge = document.getElementById('headerRoomBadge');

    // Navigation triggers in login Overlay
    btnShowCreate.addEventListener('click', () => {
        loginStep1.classList.add('hidden');
        loginCreateForm.classList.remove('hidden');
    });

    btnShowJoin.addEventListener('click', () => {
        loginStep1.classList.add('hidden');
        loginJoinForm.classList.remove('hidden');
    });

    backBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            loginCreateForm.classList.add('hidden');
            loginJoinForm.classList.add('hidden');
            loginStep1.classList.remove('hidden');
        });
    });

    // Helper: Alphanumeric Code Generator
    function generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // ========================================================
    // --- Cryptography Helpers (RC4 E2E Encryption) ---
    // ========================================================
    function rc4EncryptDecrypt(key, str) {
        const utf8Str = unescape(encodeURIComponent(str));
        const s = [];
        let j = 0;
        let x;
        let res = '';
        
        for (let i = 0; i < 256; i++) {
            s[i] = i;
        }
        for (let i = 0; i < 256; i++) {
            j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
            x = s[i];
            s[i] = s[j];
            s[j] = x;
        }
        
        let i = 0;
        j = 0;
        for (let y = 0; y < utf8Str.length; y++) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            x = s[i];
            s[i] = s[j];
            s[j] = x;
            res += String.fromCharCode(utf8Str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
        }
        return window.btoa(res);
    }

    function rc4Decrypt(key, base64Str) {
        try {
            const binaryStr = window.atob(base64Str);
            const s = [];
            let j = 0;
            let x;
            let res = '';
            
            for (let i = 0; i < 256; i++) {
                s[i] = i;
            }
            for (let i = 0; i < 256; i++) {
                j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
                x = s[i];
                s[i] = s[j];
                s[j] = x;
            }
            
            let i = 0;
            j = 0;
            for (let y = 0; y < binaryStr.length; y++) {
                i = (i + 1) % 256;
                j = (j + s[i]) % 256;
                x = s[i];
                s[i] = s[j];
                s[j] = x;
                res += String.fromCharCode(binaryStr.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
            }
            return decodeURIComponent(escape(res));
        } catch (e) {
            console.error("RC4 Decryption failed:", e);
            return null;
        }
    }

    async function deriveE2EKey(roomCode) {
        return roomCode;
    }

    async function encryptPayload(data, key) {
        const jsonStr = JSON.stringify(data);
        if (!key) return { encrypted: false, data: jsonStr };
        try {
            const encryptedData = rc4EncryptDecrypt(key, jsonStr);
            return { encrypted: true, data: encryptedData };
        } catch (e) {
            console.error("Encryption failed", e);
            return { encrypted: false, data: jsonStr };
        }
    }

    async function decryptPayload(payloadObj, key) {
        if (!payloadObj.encrypted || !key) {
            try {
                return JSON.parse(payloadObj.data);
            } catch (e) {
                return payloadObj.data;
            }
        }
        try {
            const decryptedStr = rc4Decrypt(key, payloadObj.data);
            return JSON.parse(decryptedStr);
        } catch (e) {
            console.error("Decryption failed. Room code mismatch or corrupt packet.", e);
            return null;
        }
    }

    // ==========================================
    // --- Real-time MQTT Synchronization ---
    // ==========================================
    async function broadcastSyncEvent(type, data) {
        if (!mqttClient || !mqttClient.connected) return;
        const fullPayload = {
            type: type,
            ...data
        };
        const encrypted = await encryptPayload(fullPayload, roomCryptoKey);
        mqttClient.publish(roomTopic, JSON.stringify(encrypted), { qos: 1 });
    }

    function connectToSyncBroker(code, yourName) {
        const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
        const clientId = `together-${code}-${Math.random().toString(36).substring(2, 9)}`;
        
        mqttClient = mqtt.connect(brokerUrl, {
            clientId: clientId,
            clean: true,
            keepalive: 30
        });

        mqttClient.on('connect', () => {
            console.log('Connected to MQTT sync broker.');
            mqttClient.subscribe(roomTopic, { qos: 1 }, (err) => {
                if (err) console.error("MQTT subscription error:", err);
            });
            
            // Broadcast our arrival
            broadcastSyncEvent('presence', {
                action: 'join',
                sender: yourName,
                isCreator: isCreator,
                timestamp: Date.now()
            });
        });

        mqttClient.on('message', async (topic, rawMessage) => {
            if (topic !== roomTopic) return;
            let payloadObj = null;
            try {
                payloadObj = JSON.parse(rawMessage.toString());
            } catch (e) {
                return;
            }
            
            const eventData = await decryptPayload(payloadObj, roomCryptoKey);
            if (!eventData || eventData.sender === yourName) return;
            
            handleIncomingSyncEvent(eventData);
        });

        // Start local heartbeat pings
        setInterval(() => {
            if (mqttClient && mqttClient.connected) {
                broadcastSyncEvent('presence', {
                    action: 'ping',
                    sender: yourName,
                    isCreator: isCreator,
                    timestamp: Date.now(),
                    connectionStartTime: localStorage.getItem(`together_connection_start_${code}`)
                });
            }
        }, 3000);

        // Check timeout presence
        setInterval(() => {
            if (lastPartnerActiveTime > 0) {
                const elapsed = Date.now() - lastPartnerActiveTime;
                if (elapsed > 8000) {
                    setPartnerOnline(false);
                } else {
                    setPartnerOnline(true);
                }
            } else {
                setPartnerOnline(false);
            }
        }, 1000);
    }

    function setPartnerOnline(online) {
        if (isPartnerOnline === online) return;
        isPartnerOnline = online;
        
        const chatPresenceIndicator = document.getElementById('chatPresenceIndicator');
        const btnLeaveSpace = document.getElementById('btnLeaveSpace');
        const btnSendChat = document.getElementById('btnSendChat');
        const chatInput = document.getElementById('chatInput');
        
        if (online) {
            if (chatPresenceIndicator) {
                chatPresenceIndicator.textContent = "Partner Connected";
                chatPresenceIndicator.style.color = "var(--accent)";
            }
            if (btnLeaveSpace) btnLeaveSpace.classList.remove('hidden');
            if (btnSendChat) btnSendChat.classList.remove('hidden');
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.placeholder = "Send a sweet message...";
            }
        } else {
            if (chatPresenceIndicator) {
                chatPresenceIndicator.textContent = "Waiting for partner...";
                chatPresenceIndicator.style.color = "var(--text-muted)";
            }
            if (btnLeaveSpace) btnLeaveSpace.classList.add('hidden');
            if (btnSendChat) btnSendChat.classList.add('hidden');
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = "Waiting for partner to connect...";
            }
        }
    }

    function handleIncomingSyncEvent(event) {
        const code = currentRoomCode;
        const roomKey = `together_room_${code}`;
        const permissionKey = `together_share_permission_${code}`;
        
        if (event.type === 'presence') {
            lastPartnerActiveTime = Date.now();
            setPartnerOnline(true);
            
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey)) || {};
            } catch(e) { roomData = {}; }
            
            if (event.action === 'join') {
                addNotification(`${event.sender} entered Sanctuary!`);
                if (isCreator) {
                    roomData.creator = currentUserName;
                    roomData.partner = event.sender;
                    localStorage.setItem(roomKey, JSON.stringify(roomData));
                    
                    broadcastSyncEvent('presence', {
                        action: 'sync_names',
                        creator: currentUserName,
                        partner: event.sender,
                        timestamp: Date.now()
                    });
                }
            } else if (event.action === 'sync_names') {
                roomData.creator = event.creator;
                roomData.partner = event.partner;
                localStorage.setItem(roomKey, JSON.stringify(roomData));
            } else if (event.action === 'ping') {
                if (event.connectionStartTime) {
                    const localStart = localStorage.getItem(`together_connection_start_${code}`);
                    if (!localStart || parseInt(event.connectionStartTime) < parseInt(localStart)) {
                        localStorage.setItem(`together_connection_start_${code}`, event.connectionStartTime);
                    }
                }
            } else if (event.action === 'leave') {
                addNotification(`${event.sender} left the Sanctuary.`);
                setPartnerOnline(false);
                roomData.partner = null;
                localStorage.setItem(roomKey, JSON.stringify(roomData));
            }
        }
        
        else if (event.type === 'chat') {
            const chatKey = `together_chat_${code}`;
            let chatData = [];
            try {
                chatData = JSON.parse(localStorage.getItem(chatKey)) || [];
            } catch(e) {}
            
            chatData.push({
                sender: event.sender,
                text: event.text,
                timestamp: event.timestamp
            });
            localStorage.setItem(chatKey, JSON.stringify(chatData));
            
            window.dispatchEvent(new CustomEvent('together_chat_updated'));
        }
        
        else if (event.type === 'video_load') {
            window.dispatchEvent(new CustomEvent('together_video_load', { detail: event }));
        }
        
        else if (event.type === 'video_action') {
            window.dispatchEvent(new CustomEvent('together_video_action', { detail: event }));
        }
        
        else if (event.type === 'theme') {
            localStorage.setItem(`together_theme_${code}`, event.themeName);
            window.dispatchEvent(new CustomEvent('together_theme_updated', { detail: event }));
        }
        
        else if (event.type === 'heart') {
            window.dispatchEvent(new CustomEvent('together_heart_triggered'));
        }
    }

    // Dynamic presence tracking badge
    function startRoomPresenceSync(code, yourName) {
        const roomKey = `together_room_${code}`;
        const permissionKey = `together_share_permission_${code}`;
        const creatorToggleContainer = document.getElementById('creatorToggleContainer');
        const partnerLockOverlay = document.getElementById('partnerLockOverlay');

        function syncPresence() {
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey));
            } catch(e) {}
            
            if (!roomData) {
                roomData = { creator: yourName, partner: null };
                localStorage.setItem(roomKey, JSON.stringify(roomData));
            }
            
            const creator = roomData.creator;
            const partner = roomData.partner;
            
            isCreator = (creator && yourName.toLowerCase() === creator.toLowerCase());

            // 1. Creator Toggle Visibility Control
            if (isCreator) {
                creatorToggleContainer.classList.remove('hidden');
            } else {
                creatorToggleContainer.classList.add('hidden');
            }

            // 2. Share Permission Control (Lock Dropzone for Partner)
            const btnChangeVideo = document.getElementById('btnChangeVideo');
            if (!isCreator) {
                const shareAllowed = localStorage.getItem(permissionKey) !== 'false';
                if (shareAllowed) {
                    partnerLockOverlay.classList.add('hidden');
                    if (btnChangeVideo) btnChangeVideo.classList.remove('hidden');
                } else {
                    partnerLockOverlay.classList.remove('hidden');
                    if (btnChangeVideo) btnChangeVideo.classList.add('hidden');
                }
            } else {
                partnerLockOverlay.classList.add('hidden');
                if (btnChangeVideo) btnChangeVideo.classList.remove('hidden');
            }

            // 3. Header badge presence display
            const headerUserBadge = document.getElementById('headerUserBadge');
            const badgeLoversNames = document.getElementById('badgeLoversNames');
            
            if (headerUserBadge && badgeLoversNames) {
                if (creator && partner) {
                    badgeLoversNames.textContent = `${creator} & ${partner}`;
                    
                    // Track Connection Start Time
                    const startKey = `together_connection_start_${code}`;
                    let startTime = localStorage.getItem(startKey);
                    if (!startTime) {
                        startTime = Date.now().toString();
                        localStorage.setItem(startKey, startTime);
                    }
                    
                    const connectionBadgeTime = document.getElementById('connectionBadgeTime');
                    if (connectionBadgeTime) {
                        const startDate = new Date(parseInt(startTime));
                        const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        connectionBadgeTime.textContent = `Connected since ${timeStr}`;
                        connectionBadgeTime.classList.remove('hidden');
                    }
                } else {
                    badgeLoversNames.textContent = "Waiting...";
                    const connectionBadgeTime = document.getElementById('connectionBadgeTime');
                    if (connectionBadgeTime) {
                        connectionBadgeTime.classList.add('hidden');
                    }
                    
                    if (creator && yourName.toLowerCase() !== creator.toLowerCase() && !partner) {
                        roomData.partner = yourName;
                        localStorage.setItem(roomKey, JSON.stringify(roomData));
                    } else if (partner && yourName.toLowerCase() !== partner.toLowerCase() && !creator) {
                        roomData.creator = yourName;
                        localStorage.setItem(roomKey, JSON.stringify(roomData));
                    }
                }
                headerUserBadge.classList.remove('hidden');
            }
        }

        syncPresence();
        const syncInterval = setInterval(syncPresence, 1000);
        
        window.addEventListener('storage', (e) => {
            if (e.key === roomKey || e.key === permissionKey) {
                syncPresence();
            }
        });
    }

    // Room Entrance Transition
    async function enterRoom(code, yourName, enteredAsCreator) {
        currentRoomCode = code;
        currentUserName = yourName;
        isCreator = enteredAsCreator;
        headerRoomBadge.textContent = `Room Code: ${code}`;
        
        // Cache session details
        localStorage.setItem('together_session_code', code);
        localStorage.setItem('together_session_name', yourName);
        localStorage.setItem('together_session_is_creator', enteredAsCreator ? 'true' : 'false');
        
        roomCryptoKey = await deriveE2EKey(code);
        roomTopic = `together/rooms/${code}/events`;
        
        // Initialize Real-time Connection
        connectToSyncBroker(code, yourName);

        // Start Presence badge sync loop
        startRoomPresenceSync(code, yourName);

        // Start Chat list synchronization
        startChatSync(code);

        // Start Shared Video Synchronization
        startVideoSync(code);

        // Start Theme synchronization
        startThemeSync(code);

        // Start Heart gesture synchronization
        startHeartSync(code);

        // Start Leave Space functionality
        startLeaveSpaceAction(code);

        addNotification(`Connected! Welcome to the Sanctuary, ${yourName}.`);
        
        loginScreen.classList.remove('active');
        setTimeout(() => {
            loginScreen.style.display = 'none';
            appScreen.classList.remove('hidden');
        }, 500);
    }

    // Auto-login session recovery
    const savedCode = localStorage.getItem('together_session_code');
    const savedName = localStorage.getItem('together_session_name');
    const savedIsCreator = localStorage.getItem('together_session_is_creator') === 'true';
    if (savedCode && savedName) {
        enterRoom(savedCode, savedName, savedIsCreator);
    }

    // Create Room Form Action
    document.getElementById('createRoomForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const yourName = document.getElementById('createYourName').value.trim();
        if (yourName) {
            const newCode = generateRoomCode();
            document.getElementById('generatedCodeDisplay').textContent = newCode;
            
            // Store Room State
            const roomKey = `together_room_${newCode}`;
            const permissionKey = `together_share_permission_${newCode}`;
            
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey));
            } catch(err) {}
            
            if (roomData) {
                roomData.creator = yourName;
            } else {
                roomData = { creator: yourName, partner: null };
            }
            
            localStorage.setItem(roomKey, JSON.stringify(roomData));
            localStorage.setItem(permissionKey, 'true'); // Creator default allows sharing
            
            // Pass values to start button
            const startBtn = document.getElementById('btnEnterCreatedRoom');
            startBtn.dataset.code = newCode;
            startBtn.dataset.name = yourName;

            loginCreateForm.classList.add('hidden');
            loginRoomCreated.classList.remove('hidden');
        }
    });

    document.getElementById('btnEnterCreatedRoom').addEventListener('click', (e) => {
        const code = e.target.dataset.code;
        const name = e.target.dataset.name;
        enterRoom(code, name, true);
    });

    // Join Room Form Action
    document.getElementById('joinRoomForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
        const name = document.getElementById('joinYourName').value.trim();
        if (code && name) {
            const roomKey = `together_room_${code}`;
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey));
            } catch(err) {}
            
            if (roomData) {
                if (roomData.creator && name.toLowerCase() === roomData.creator.toLowerCase()) {
                    // Re-joining as creator
                } else if (roomData.partner && name.toLowerCase() === roomData.partner.toLowerCase()) {
                    // Re-joining as partner
                } else if (!roomData.partner) {
                    roomData.partner = name;
                } else if (!roomData.creator) {
                    roomData.creator = name;
                } else {
                    roomData.partner = name;
                }
            } else {
                // Partner joins first (no creator yet)
                roomData = { creator: null, partner: name };
            }
            localStorage.setItem(roomKey, JSON.stringify(roomData));
            
            enterRoom(code, name, false);
        }
    });

    // ==========================================
    // --- Creator Toggle Action Listeners ---
    // ==========================================
    const creatorShareToggle = document.getElementById('creatorShareToggle');
    if (creatorShareToggle) {
        creatorShareToggle.addEventListener('change', () => {
            if (currentRoomCode) {
                const permissionKey = `together_share_permission_${currentRoomCode}`;
                const nextState = creatorShareToggle.checked ? 'true' : 'false';
                localStorage.setItem(permissionKey, nextState);
                
                broadcastSyncEvent('theme', {
                    syncAction: 'permission_change',
                    permissionState: nextState,
                    sender: currentUserName,
                    timestamp: Date.now()
                });
                
                addNotification(creatorShareToggle.checked ? "Partner allowed to share videos" : "Partner sharing permissions locked");
            }
        });
    }

    // ==========================================
    // --- Lover's Chat synchronization ---
    // ==========================================
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatScroller = document.getElementById('chatScroller');
    const quickEmojiBtns = document.querySelectorAll('.quick-emoji-btn');

    function startChatSync(code) {
        const chatKey = `together_chat_${code}`;

        function renderChat() {
            let chatData = [];
            try {
                chatData = JSON.parse(localStorage.getItem(chatKey)) || [];
            } catch(e) {}

            // Render chats
            chatScroller.innerHTML = `<div class="system-message" style="align-self: center; background: rgba(226, 149, 135, 0.08); padding: 6px 16px; border-radius: 20px; font-size: 0.75rem; color: var(--text-muted); border: 1px solid var(--glass-border);">Connected to private space. ❤️</div>`;
            
            chatData.forEach(msg => {
                const bubble = document.createElement('div');
                const isYou = msg.sender.toLowerCase() === currentUserName.toLowerCase();
                bubble.className = `chat-bubble ${isYou ? 'you' : 'partner'}`;
                
                bubble.innerHTML = `
                    <div class="chat-sender-name">${isYou ? 'You' : msg.sender}</div>
                    <div class="chat-text">${msg.text}</div>
                    <span class="chat-time">${msg.timestamp}</span>
                `;
                chatScroller.appendChild(bubble);
            });

            // Keep scrolled to bottom
            chatScroller.scrollTop = chatScroller.scrollHeight;
        }

        function sendMessage(text) {
            if (!text.trim()) return;
            let chatData = [];
            try {
                chatData = JSON.parse(localStorage.getItem(chatKey)) || [];
            } catch(e) {}

            const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            chatData.push({
                sender: currentUserName,
                text: text,
                timestamp: timeStr
            });

            localStorage.setItem(chatKey, JSON.stringify(chatData));
            
            // Broadcast to partner
            broadcastSyncEvent('chat', {
                sender: currentUserName,
                text: text,
                timestamp: timeStr
            });
            
            renderChat();
        }

        // Chat Form Submission
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = chatInput.value.trim();
            if (text) {
                sendMessage(text);
                chatInput.value = '';
            }
        });

        // Emoji Shortcut Clicks
        quickEmojiBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sendMessage(btn.textContent);
            });
        });

        // Initial render & listeners
        renderChat();
        
        window.addEventListener('together_chat_updated', () => {
            renderChat();
        });
        
        window.addEventListener('storage', (e) => {
            if (e.key === chatKey) {
                renderChat();
            }
        });
    }

    // ==========================================
    // --- Gallery Video Player Logic (Plyr) ---
    // ==========================================
    const videoDropzone = document.getElementById('videoDropzone');
    const videoFileInput = document.getElementById('videoFileInput');
    const btnSelectVideo = document.getElementById('btnSelectVideo');
    const videoPlayerWrapper = document.getElementById('videoPlayerWrapper');
    const btnChangeVideo = document.getElementById('btnChangeVideo');

    // Wire Plyr Event Listeners for Live Broadcast
    plyrPlayer.on('play', () => {
        if (isIncomingSync) return;
        broadcastVideoAction('play', plyrPlayer.currentTime);
    });

    plyrPlayer.on('pause', () => {
        if (isIncomingSync) return;
        broadcastVideoAction('pause', plyrPlayer.currentTime);
    });

    plyrPlayer.on('seeked', () => {
        if (isIncomingSync) return;
        broadcastVideoAction('seek', plyrPlayer.currentTime);
    });

    const CDN_PREVIEW_VIDEOS = [
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    ];

    // Dropzone Click Select
    videoDropzone.addEventListener('click', () => {
        if (!isCreator) {
            const shareAllowed = localStorage.getItem(`together_share_permission_${currentRoomCode}`) !== 'false';
            if (!shareAllowed) {
                addNotification("Creator locked uploads. You cannot share right now.");
                return;
            }
        }
        videoFileInput.click();
    });

    btnSelectVideo.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isCreator) {
            const shareAllowed = localStorage.getItem(`together_share_permission_${currentRoomCode}`) !== 'false';
            if (!shareAllowed) {
                addNotification("Creator locked uploads. You cannot share right now.");
                return;
            }
        }
        videoFileInput.click();
    });

    videoFileInput.addEventListener('change', (e) => {
        if(e.target.files.length > 0) loadLocalVideo(e.target.files[0], true);
    });

    // Drag & Drop File Upload Bindings
    ['dragenter', 'dragover'].forEach(eventName => {
        videoDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            videoDropzone.style.borderColor = 'var(--primary)';
            videoDropzone.style.background = 'rgba(224, 47, 108, 0.05)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        videoDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            videoDropzone.style.borderColor = 'var(--glass-border)';
            videoDropzone.style.background = 'rgba(0,0,0,0.15)';
        }, false);
    });

    videoDropzone.addEventListener('drop', (e) => {
        if (!isCreator) {
            const shareAllowed = localStorage.getItem(`together_share_permission_${currentRoomCode}`) !== 'false';
            if (!shareAllowed) {
                addNotification("Creator locked uploads. You cannot share right now.");
                return;
            }
        }
        const dt = e.dataTransfer;
        const files = dt.files;
        if(files.length > 0) loadLocalVideo(files[0], true);
    });

    function loadLocalVideo(file, triggerBroadcast = false) {
        if(!file.type.startsWith('video/')) {
            addNotification("Please select a valid video file!");
            return;
        }

        const fileUrl = URL.createObjectURL(file);
        
        isIncomingSync = true;
        plyrPlayer.source = {
            type: 'video',
            sources: [
                {
                    src: fileUrl,
                    type: file.type
                }
            ]
        };
        
        videoDropzone.classList.add('hidden');
        videoPlayerWrapper.classList.remove('hidden');
        
        plyrPlayer.play().catch(err => console.log("Autoplay failed/blocked:", err));
        isIncomingSync = false;
        
        addNotification(`Shared video: ${file.name}`);

        if (triggerBroadcast && currentRoomCode) {
            const cdnUrl = CDN_PREVIEW_VIDEOS[Math.floor(Math.random() * CDN_PREVIEW_VIDEOS.length)];
            
            // Broadcast load event
            broadcastSyncEvent('video_load', {
                fileName: file.name,
                videoUrl: cdnUrl,
                sender: currentUserName,
                timestamp: Date.now()
            });
        }
    }

    // Unload / Change Video
    btnChangeVideo.addEventListener('click', (e) => {
        e.stopPropagation();
        unloadVideo();
        broadcastVideoAction('unload', 0);
    });

    function unloadVideo() {
        isIncomingSync = true;
        plyrPlayer.pause();
        plyrPlayer.source = {}; // Reset source
        videoPlayerWrapper.classList.add('hidden');
        videoDropzone.classList.remove('hidden');
        videoFileInput.value = "";
        isIncomingSync = false;
    }

    // Shared Video Sync (Sync play/pause/seeks and Takeover)
    function broadcastVideoAction(action, time) {
        if (currentRoomCode) {
            broadcastSyncEvent('video_action', {
                action: action,
                time: time,
                sender: currentUserName,
                timestamp: Date.now()
            });
        }
    }

    function startVideoSync(code) {
        window.addEventListener('together_video_load', (e) => {
            const videoData = e.detail;
            
            isIncomingSync = true;
            plyrPlayer.source = {
                type: 'video',
                sources: [
                    {
                        src: videoData.videoUrl,
                        type: 'video/mp4'
                    }
                ]
            };
            
            videoDropzone.classList.add('hidden');
            videoPlayerWrapper.classList.remove('hidden');
            
            plyrPlayer.play().catch(err => console.log("Autoplay failed/blocked:", err));
            
            // Brief timeout to let Plyr process source loading before clearing flag
            setTimeout(() => {
                isIncomingSync = false;
            }, 200);

            addNotification(`${videoData.sender} shared: "${videoData.fileName}" (Syncing Preview)`);
        });

        window.addEventListener('together_video_action', (e) => {
            const actionData = e.detail;
            
            isIncomingSync = true;
            if (actionData.action === 'play') {
                plyrPlayer.currentTime = actionData.time;
                plyrPlayer.play().catch(err => {});
            } else if (actionData.action === 'pause') {
                plyrPlayer.currentTime = actionData.time;
                plyrPlayer.pause();
            } else if (actionData.action === 'seek') {
                plyrPlayer.currentTime = actionData.time;
            } else if (actionData.action === 'unload') {
                unloadVideo();
                addNotification(`${actionData.sender} removed the active video.`);
            }
            
            // Hold flag to prevent local feedback loops
            setTimeout(() => {
                isIncomingSync = false;
            }, 200);
        });
    }

    // ==========================================
    // --- Theme & Romantic Backdrop Synchronization ---
    // ==========================================
    function startThemeSync(code) {
        const themeKey = `together_theme_${code}`;
        const themeBtns = document.querySelectorAll('.btn-theme');
        
        function applyTheme(themeName) {
            document.body.classList.remove('theme-burgundy', 'theme-midnight', 'theme-sunset', 'theme-rosegold');
            document.body.classList.add(`theme-${themeName}`);
            
            themeBtns.forEach(btn => {
                if (btn.dataset.theme === themeName) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
        
        // Initial Theme Load
        const currentTheme = localStorage.getItem(themeKey) || 'burgundy';
        applyTheme(currentTheme);
        
        // Click Listeners
        themeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const selectedTheme = btn.dataset.theme;
                localStorage.setItem(themeKey, selectedTheme);
                applyTheme(selectedTheme);
                addNotification(`Backdrop set to ${btn.textContent}`);
                
                // Broadcast theme change
                broadcastSyncEvent('theme', {
                    themeName: selectedTheme,
                    sender: currentUserName,
                    timestamp: Date.now()
                });
            });
        });

        // Listen for incoming theme events
        window.addEventListener('together_theme_updated', (e) => {
            applyTheme(e.detail.themeName);
        });
    }

    // ==========================================
    // --- Heart Burst Double Tap Synchronization ---
    // ==========================================
    function startHeartSync(code) {
        function spawnHeartsLocal() {
            const container = document.getElementById('videoPlayerWrapper');
            if (!container || container.classList.contains('hidden')) return;
            
            for (let i = 0; i < 6; i++) {
                setTimeout(() => {
                    const heart = document.createElement('div');
                    heart.className = 'floating-heart';
                    heart.textContent = '❤️';
                    
                    const randomLeft = Math.floor(Math.random() * 80) + 10;
                    heart.style.left = `${randomLeft}%`;
                    heart.style.bottom = '10px';
                    
                    const size = (Math.random() * 0.8 + 0.8).toFixed(1);
                    heart.style.fontSize = `${size}rem`;
                    
                    const duration = (Math.random() * 1.5 + 2).toFixed(1);
                    heart.style.animationDuration = `${duration}s`;
                    
                    container.appendChild(heart);
                    
                    setTimeout(() => heart.remove(), parseFloat(duration) * 1000);
                }, i * 200);
            }
        }
        
        let lastTap = 0;
        videoPlayerWrapper.addEventListener('click', (e) => {
            if (e.target.closest('#btnChangeVideo') || e.target.closest('.plyr__controls') || e.target.closest('.plyr__control')) return;
            
            const now = Date.now();
            if (now - lastTap < 300) {
                // Broadcast heart trigger
                broadcastSyncEvent('heart', {
                    sender: currentUserName,
                    timestamp: Date.now()
                });
                spawnHeartsLocal();
            }
            lastTap = now;
        });

        videoPlayerWrapper.addEventListener('touchstart', (e) => {
            if (e.target.closest('#btnChangeVideo') || e.target.closest('.plyr__controls') || e.target.closest('.plyr__control')) return;
            
            const now = Date.now();
            if (now - lastTap < 300) {
                // Broadcast heart trigger
                broadcastSyncEvent('heart', {
                    sender: currentUserName,
                    timestamp: Date.now()
                });
                spawnHeartsLocal();
            }
            lastTap = now;
        });
        
        window.addEventListener('together_heart_triggered', () => {
            spawnHeartsLocal();
        });
    }

    // ==========================================
    // --- Leave Space Overlay Countdown Sequence ---
    // ==========================================
    function startLeaveSpaceAction(code) {
        let leaveInterval = null;
        const btnLeaveSpace = document.getElementById('btnLeaveSpace');
        const leaveOverlay = document.getElementById('leaveOverlay');
        const leaveTimeSummary = document.getElementById('leaveTimeSummary');
        const leaveCountdownDisplay = document.getElementById('leaveCountdownDisplay');
        const btnCancelLeave = document.getElementById('btnCancelLeave');
        const btnConfirmLeaveNow = document.getElementById('btnConfirmLeaveNow');

        if (btnLeaveSpace) {
            btnLeaveSpace.addEventListener('click', () => {
                leaveOverlay.classList.remove('hidden');
                leaveOverlay.classList.add('active');
                
                const startKey = `together_connection_start_${code}`;
                const startTimeStr = localStorage.getItem(startKey);
                let elapsedSecs = 0;
                
                if (startTimeStr) {
                    const startTime = parseInt(startTimeStr);
                    elapsedSecs = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
                }
                
                const mins = Math.floor(elapsedSecs / 60);
                const secs = elapsedSecs % 60;
                
                let timeStr = "";
                if (mins > 0) {
                    timeStr = `${mins} minute${mins > 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`;
                } else {
                    timeStr = `${secs} second${secs !== 1 ? 's' : ''}`;
                }
                
                leaveTimeSummary.innerHTML = `You shared <span style="color: var(--primary); font-weight: 500;">${timeStr}</span> of beautiful moments together. ❤️`;
                
                let countdown = 5;
                leaveCountdownDisplay.textContent = countdown;
                
                if (leaveInterval) clearInterval(leaveInterval);
                leaveInterval = setInterval(() => {
                    countdown--;
                    leaveCountdownDisplay.textContent = countdown;
                    if (countdown <= 0) {
                        clearInterval(leaveInterval);
                        executeLeave();
                    }
                }, 1000);
            });
        }

        if (btnCancelLeave) {
            btnCancelLeave.addEventListener('click', () => {
                if (leaveInterval) clearInterval(leaveInterval);
                leaveOverlay.classList.remove('active');
                leaveOverlay.classList.add('hidden');
            });
        }

        if (btnConfirmLeaveNow) {
            btnConfirmLeaveNow.addEventListener('click', () => {
                if (leaveInterval) clearInterval(leaveInterval);
                executeLeave();
            });
        }

        function executeLeave() {
            // Broadcast leave
            broadcastSyncEvent('presence', {
                action: 'leave',
                sender: currentUserName,
                timestamp: Date.now()
            });

            const roomKey = `together_room_${code}`;
            const startKey = `together_connection_start_${code}`;
            
            // Clear current session
            localStorage.removeItem('together_session_code');
            localStorage.removeItem('together_session_name');
            localStorage.removeItem('together_session_is_creator');

            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey));
            } catch(e) {}
            
            if (roomData) {
                if (roomData.creator && roomData.creator.toLowerCase() === currentUserName.toLowerCase()) {
                    roomData.creator = null;
                } else if (roomData.partner && roomData.partner.toLowerCase() === currentUserName.toLowerCase()) {
                    roomData.partner = null;
                }
                
                if (!roomData.creator && !roomData.partner) {
                    localStorage.removeItem(roomKey);
                    localStorage.removeItem(startKey);
                    localStorage.removeItem(`together_timer_${code}`);
                    localStorage.removeItem(`together_video_${code}`);
                    localStorage.removeItem(`together_video_action_${code}`);
                    localStorage.removeItem(`together_share_permission_${code}`);
                    localStorage.removeItem(`together_theme_${code}`);
                    localStorage.removeItem(`together_chat_${code}`);
                } else {
                    localStorage.setItem(roomKey, JSON.stringify(roomData));
                }
            }

            if (mqttClient) {
                mqttClient.end();
            }
            
            window.location.reload();
        }
    }

    // ==========================================
    // --- Helper Utilities ---
    // ==========================================
    function addNotification(msg) {
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '30px';
        toast.style.right = '30px';
        toast.style.background = 'var(--primary)';
        toast.style.color = 'white';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '30px';
        toast.style.zIndex = '99999';
        toast.style.boxShadow = '0 8px 30px rgba(224, 47, 108, 0.4)';
        toast.style.fontFamily = 'var(--font-body)';
        toast.style.fontSize = '0.9rem';
        toast.style.fontWeight = '500';
        toast.innerText = msg;
        
        document.body.appendChild(toast);
        
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1)';
        
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 50);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
        }, 2700);
        
        setTimeout(() => toast.remove(), 3000);
    }
});
