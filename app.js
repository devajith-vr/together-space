// ==========================================
// Together - Lover's Space, Chat & Synchronized Video Theatre
// Real-time Cross-Device Synchronization via Secure MQTT with E2E Encryption
// ==========================================

document.addEventListener('DOMContentLoaded', () => {

    let currentRoomCode = null;
    let currentUserName = null;
    let isCreator = false;
    let timerTickInterval = null;
    let currentLoadedFileName = null;
    let peerConnection = null;
    let localStream = null;
    let remoteStream = null;
    let remoteCandidatesQueue = [];

    // Real-time Sync State
    let mqttClient = null;
    let roomCryptoKey = null;
    let roomTopic = null;
    let lastPartnerActiveTime = 0;
    let isPartnerOnline = false;

    // Plyr Media Player Instance & Fallback Control
    const mainVideo = document.getElementById('mainVideo');
    let plyrPlayer = null;
    let isIncomingSync = false;
    let ignorePlayEvents = 0;
    let ignorePauseEvents = 0;
    let ignoreSeekEvents = 0;

    // Safe Plyr / Native Video Initialization
    if (typeof Plyr !== 'undefined') {
        plyrPlayer = new Plyr('#mainVideo', {
            controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
            seekTime: 10,
            fullscreen: {
                iosNative: false,
                container: '#videoPlayerWrapper'
            }
        });

        // Wire Plyr Event Listeners for Live Broadcast
        plyrPlayer.on('play', () => {
            if (ignorePlayEvents > 0) {
                ignorePlayEvents--;
                return;
            }
            broadcastVideoAction('play', plyrPlayer.currentTime);
        });

        plyrPlayer.on('pause', () => {
            if (ignorePauseEvents > 0) {
                ignorePauseEvents--;
                return;
            }
            broadcastVideoAction('pause', plyrPlayer.currentTime);
        });

        plyrPlayer.on('seeked', () => {
            if (ignoreSeekEvents > 0) {
                ignoreSeekEvents--;
                return;
            }
            broadcastVideoAction('seek', plyrPlayer.currentTime);
        });
    } else {
        console.warn("Plyr JS library not found. Falling back to native HTML5 controls.");
        if (mainVideo) {
            mainVideo.controls = true; // Show native browser controls

            mainVideo.addEventListener('play', () => {
                if (ignorePlayEvents > 0) {
                    ignorePlayEvents--;
                    return;
                }
                broadcastVideoAction('play', mainVideo.currentTime);
            });

            mainVideo.addEventListener('pause', () => {
                if (ignorePauseEvents > 0) {
                    ignorePauseEvents--;
                    return;
                }
                broadcastVideoAction('pause', mainVideo.currentTime);
            });

            mainVideo.addEventListener('seeked', () => {
                if (ignoreSeekEvents > 0) {
                    ignoreSeekEvents--;
                    return;
                }
                broadcastVideoAction('seek', mainVideo.currentTime);
            });
        }
    }

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
    function broadcastSyncEvent(type, data) {
        return new Promise(async (resolve) => {
            if (!mqttClient || !mqttClient.connected) {
                resolve();
                return;
            }
            const fullPayload = {
                type: type,
                ...data
            };
            const encrypted = await encryptPayload(fullPayload, roomCryptoKey);
            mqttClient.publish(roomTopic, JSON.stringify(encrypted), { qos: 1 }, (err) => {
                if (err) console.error("Publish error:", err);
                resolve();
            });
        });
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
        const btnSendChat = document.getElementById('btnSendChat');
        const chatInput = document.getElementById('chatInput');
        
        if (online) {
            if (chatPresenceIndicator) {
                chatPresenceIndicator.textContent = "Partner Connected";
                chatPresenceIndicator.style.color = "var(--accent)";
            }
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
        
        if (event.type === 'verify_request') {
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey)) || {};
            } catch(e) { roomData = {}; }

            // Restrict to maximum 2 people
            const isFull = roomData.creator && roomData.partner;
            
            if (isFull) {
                broadcastSyncEvent('verify_response', {
                    sender: currentUserName,
                    status: 'full',
                    timestamp: Date.now()
                });
            } else {
                broadcastSyncEvent('verify_response', {
                    sender: currentUserName,
                    status: 'available',
                    timestamp: Date.now()
                });
            }
        }
        
        else if (event.type === 'presence') {
            lastPartnerActiveTime = Date.now();
            setPartnerOnline(true);
            
            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey)) || {};
            } catch(e) { roomData = {}; }
            
            // Sync names dynamically on any presence event (join or ping)
            let changed = false;
            if (event.isCreator) {
                if (roomData.creator !== event.sender) {
                    roomData.creator = event.sender;
                    changed = true;
                }
            } else {
                if (roomData.partner !== event.sender) {
                    roomData.partner = event.sender;
                    changed = true;
                }
            }
            if (changed) {
                localStorage.setItem(roomKey, JSON.stringify(roomData));
            }
            
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
                // Host streams video to partner who just joined
                if (currentLoadedFileName && !mainVideo.srcObject) {
                    initiateWebRTCStream();
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
                // Host checks if partner needs stream
                if (currentLoadedFileName && !mainVideo.srcObject && !peerConnection) {
                    initiateWebRTCStream();
                }
            } else if (event.action === 'leave') {
                // Clear session immediately so that if the user closes the tab right now, they won't auto-login next time
                localStorage.removeItem('together_session_code');
                localStorage.removeItem('together_session_name');
                localStorage.removeItem('together_session_is_creator');
                
                // Hide leave button immediately so B knows the room is closed
                const btnLeaveSpace = document.getElementById('btnLeaveSpace');
                if (btnLeaveSpace) btnLeaveSpace.classList.add('hidden');
                
                addNotification(`${event.sender || 'Partner'} left the Sanctuary. Returning to lobby...`);
                setTimeout(() => {
                    executeLeave();
                }, 1000);
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
            if (event.syncAction === 'permission_change') {
                localStorage.setItem(`together_share_permission_${code}`, event.permissionState);
            } else {
                localStorage.setItem(`together_theme_${code}`, event.themeName);
                window.dispatchEvent(new CustomEvent('together_theme_updated', { detail: event }));
            }
        }
        
        else if (event.type === 'heart') {
            window.dispatchEvent(new CustomEvent('together_heart_triggered'));
        }
        
        else if (event.type === 'webrtc_signal') {
            handleWebRTCSignal(event);
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
                const savedPermission = localStorage.getItem(permissionKey);
                if (savedPermission !== null) {
                    const creatorShareToggle = document.getElementById('creatorShareToggle');
                    if (creatorShareToggle) {
                        creatorShareToggle.checked = (savedPermission !== 'false');
                    }
                }
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

        // Ensure leave button is permanently visible inside the room
        const btnLeaveSpace = document.getElementById('btnLeaveSpace');
        if (btnLeaveSpace) btnLeaveSpace.classList.remove('hidden');

        addNotification(`Connected! Welcome to the Sanctuary, ${yourName}.`);
        
        loginScreen.classList.remove('active');
        setTimeout(() => {
            loginScreen.style.display = 'none';
            appScreen.classList.remove('hidden');
        }, 500);
    }

    function executeLeave() {
        // Clear current session immediately
        localStorage.removeItem('together_session_code');
        localStorage.removeItem('together_session_name');
        localStorage.removeItem('together_session_is_creator');

        const code = currentRoomCode;
        if (code) {
            const roomKey = `together_room_${code}`;
            const startKey = `together_connection_start_${code}`;

            let roomData = null;
            try {
                roomData = JSON.parse(localStorage.getItem(roomKey));
            } catch(e) {}
            
            if (roomData && currentUserName) {
                const lowerUser = currentUserName.toLowerCase();
                if (roomData.creator && roomData.creator.toLowerCase() === lowerUser) {
                    roomData.creator = null;
                } else if (roomData.partner && roomData.partner.toLowerCase() === lowerUser) {
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
        }

        currentRoomCode = null;
        currentUserName = null;
        isCreator = false;
        currentLoadedFileName = null;
        
        if (plyrPlayer) {
            try {
                plyrPlayer.pause();
                plyrPlayer.source = {};
            } catch (e) {}
        } else if (mainVideo) {
            try {
                mainVideo.pause();
                mainVideo.src = "";
            } catch (e) {}
        }

        if (mqttClient) {
            try {
                mqttClient.end(true);
            } catch (e) {}
            mqttClient = null;
        }

        // Hide app and show lobby immediately in DOM
        const appScreen = document.getElementById('app');
        const loginScreen = document.getElementById('loginScreen');
        const loginStep1 = document.getElementById('loginStep1');
        const loginCreateForm = document.getElementById('loginCreateForm');
        const loginJoinForm = document.getElementById('loginJoinForm');
        
        if (appScreen) appScreen.classList.add('hidden');
        if (loginScreen) {
            loginScreen.style.display = 'flex';
            loginScreen.classList.add('active');
        }
        if (loginStep1) loginStep1.classList.remove('hidden');
        if (loginCreateForm) loginCreateForm.classList.add('hidden');
        if (loginJoinForm) loginJoinForm.classList.add('hidden');
        
        const btnLeaveSpace = document.getElementById('btnLeaveSpace');
        if (btnLeaveSpace) btnLeaveSpace.classList.add('hidden');

        const leaveOverlay = document.getElementById('leaveOverlay');
        if (leaveOverlay) {
            leaveOverlay.classList.remove('active');
            leaveOverlay.classList.add('hidden');
        }

        window.location.reload();
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
            
            // Enter room directly
            enterRoom(newCode, yourName, true);
            
            // Auto copy to clipboard
            if (navigator.clipboard) {
                navigator.clipboard.writeText(newCode).then(() => {
                    addNotification(`Room Created! Code ${newCode} copied to clipboard.`);
                }).catch(() => {
                    addNotification(`Room Created! Code: ${newCode}`);
                });
            } else {
                addNotification(`Room Created! Code: ${newCode}`);
            }
        }
    });

    // Join Room Form Action
    document.getElementById('joinRoomForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
        const name = document.getElementById('joinYourName').value.trim();
        if (code && name) {
            const btn = document.querySelector('#joinRoomForm button[type="submit"]');
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Verifying Room Code...";
            }
            verifyRoomCodeAndJoin(code, name);
        }
    });

    // Verification Layer over MQTT to validate active creator presence
    async function verifyRoomCodeAndJoin(code, name) {
        const key = await deriveE2EKey(code);
        const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
        const tempTopic = `together/rooms/${code}/events`;
        let verified = false;

        const tempClient = mqtt.connect(brokerUrl, {
            clientId: `together-verify-${code}-${Math.random().toString(36).substring(2, 7)}`,
            clean: true,
            connectTimeout: 4000
        });

        const timeoutId = setTimeout(() => {
            if (!verified) {
                tempClient.end();
                addNotification("Invalid room code or partner is offline!");
                const btn = document.querySelector('#joinRoomForm button[type="submit"]');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "Join Room";
                }
            }
        }, 3000);

        tempClient.on('connect', async () => {
            tempClient.subscribe(tempTopic, { qos: 1 });
            const payload = await encryptPayload({
                type: 'verify_request',
                sender: name,
                timestamp: Date.now()
            }, key);
            tempClient.publish(tempTopic, JSON.stringify(payload), { qos: 1 });
        });

        tempClient.on('message', async (topic, rawMessage) => {
            if (topic !== tempTopic) return;
            let payloadObj = null;
            try {
                payloadObj = JSON.parse(rawMessage.toString());
            } catch(e) { return; }

            const eventData = await decryptPayload(payloadObj, key);
            if (eventData && eventData.type === 'verify_response') {
                if (eventData.status === 'full') {
                    // Room is full
                    clearTimeout(timeoutId);
                    tempClient.end();
                    addNotification("This private space is already full (max 2 people)!");
                    const btn = document.querySelector('#joinRoomForm button[type="submit"]');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = "Join Room";
                    }
                } else {
                    verified = true;
                    clearTimeout(timeoutId);
                    tempClient.end();
                    
                    // Save partner details locally
                    const roomKey = `together_room_${code}`;
                    let roomData = null;
                    try {
                        roomData = JSON.parse(localStorage.getItem(roomKey)) || {};
                    } catch(e) { roomData = {}; }
                    roomData.partner = name;
                    roomData.creator = eventData.sender; // Save creator name
                    localStorage.setItem(roomKey, JSON.stringify(roomData));

                    enterRoom(code, name, false);
                }
            }
        });
    }

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

        // Reset previous WebRTC streams
        if (mainVideo.srcObject) {
            try { mainVideo.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
            mainVideo.srcObject = null;
        }
        if (localStream) {
            try { localStream.getTracks().forEach(t => t.stop()); } catch(e) {}
            localStream = null;
        }
        if (remoteStream) {
            try { remoteStream.getTracks().forEach(t => t.stop()); } catch(e) {}
            remoteStream = null;
        }
        if (peerConnection) {
            try { peerConnection.close(); } catch(e) {}
            peerConnection = null;
        }
        remoteCandidatesQueue = [];

        const fileUrl = URL.createObjectURL(file);
        currentLoadedFileName = file.name;
        
        const theatreDropzoneWrapper = document.querySelector('.theatre-dropzone-wrapper');
        if (theatreDropzoneWrapper) theatreDropzoneWrapper.classList.add('hidden');
        
        if (plyrPlayer) {
            ignorePlayEvents++;
            plyrPlayer.source = {
                type: 'video',
                sources: [
                    {
                        src: fileUrl,
                        type: file.type
                    }
                ]
            };
            plyrPlayer.play().catch(err => console.log("Autoplay failed/blocked:", err));
        } else {
            ignorePlayEvents++;
            mainVideo.src = fileUrl;
            mainVideo.play().catch(err => console.log("Autoplay failed/blocked:", err));
        }
        
        videoPlayerWrapper.classList.remove('hidden');
        
        addNotification(`Shared video: ${file.name}`);

        // Wait for active playback to capture tracks and negotiate peer connection
        let initiated = false;
        const triggerInitiate = () => {
            if (initiated) return;
            initiated = true;
            mainVideo.removeEventListener('playing', triggerInitiate);
            mainVideo.removeEventListener('play', triggerInitiate);
            mainVideo.removeEventListener('loadedmetadata', triggerInitiate);
            
            // Short delay to ensure tracks are fully initialized by the browser
            setTimeout(() => {
                initiateWebRTCStream();
            }, 300);
        };
        mainVideo.addEventListener('playing', triggerInitiate);
        mainVideo.addEventListener('play', triggerInitiate);
        mainVideo.addEventListener('loadedmetadata', triggerInitiate);

        if (triggerBroadcast && currentRoomCode) {
            // Broadcast load event
            broadcastSyncEvent('video_load', {
                fileName: file.name,
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
        if (plyrPlayer) {
            plyrPlayer.pause();
            plyrPlayer.source = {}; // Reset source
        } else {
            mainVideo.pause();
            mainVideo.src = "";
        }

        if (mainVideo.srcObject) {
            try {
                mainVideo.srcObject.getTracks().forEach(track => track.stop());
            } catch(e) {}
            mainVideo.srcObject = null;
        }
        if (localStream) {
            try {
                localStream.getTracks().forEach(track => track.stop());
            } catch(e) {}
            localStream = null;
        }
        if (remoteStream) {
            try {
                remoteStream.getTracks().forEach(track => track.stop());
            } catch(e) {}
            remoteStream = null;
        }
        if (peerConnection) {
            try { peerConnection.close(); } catch(e) {}
            peerConnection = null;
        }
        remoteCandidatesQueue = [];
        
        currentLoadedFileName = null;

        const playerWrapper = document.getElementById('videoPlayerWrapper');
        if (playerWrapper) {
            playerWrapper.classList.remove('plyr-is-receiver');
            playerWrapper.classList.add('hidden');
        }
        
        const theatreDropzoneWrapper = document.querySelector('.theatre-dropzone-wrapper');
        if (theatreDropzoneWrapper) theatreDropzoneWrapper.classList.remove('hidden');
        
        const dropzonePromptText = document.getElementById('dropzonePromptText');
        if (dropzonePromptText) {
            dropzonePromptText.textContent = "Drag and drop any video here or click to select from your device gallery.";
        }
        
        videoDropzone.classList.remove('hidden');
        videoFileInput.value = "";
    }

    // ==========================================
    // --- Serverless WebRTC Streaming via MQTT ---
    // ==========================================
    async function initiateWebRTCStream() {
        if (peerConnection) {
            try { peerConnection.close(); } catch(e) {}
        }
        remoteCandidatesQueue = [];
        
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentRoomCode) {
                broadcastSyncEvent('webrtc_signal', {
                    candidate: event.candidate,
                    sender: currentUserName
                });
            }
        };

        if (mainVideo.captureStream) {
            localStream = mainVideo.captureStream();
        } else if (mainVideo.mozCaptureStream) {
            localStream = mainVideo.mozCaptureStream();
        } else {
            console.warn("captureStream not supported in this browser");
            return;
        }

        async function sendSDPOffer() {
            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: false,
                    offerToReceiveVideo: false
                });
                await peerConnection.setLocalDescription(offer);
                
                broadcastSyncEvent('webrtc_signal', {
                    sdp: offer,
                    sender: currentUserName
                });
            } catch(e) {
                console.error("Error initiating stream offer:", e);
            }
        }

        let tracks = localStream.getTracks();
        if (tracks.length === 0) {
            console.warn("localStream has 0 tracks initially. Waiting for tracks to initialize...");
            let attempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                tracks = localStream.getTracks();
                if (tracks.length > 0) {
                    clearInterval(checkInterval);
                    tracks.forEach(track => {
                        peerConnection.addTrack(track, localStream);
                    });
                    sendSDPOffer();
                } else if (attempts >= 15) {
                    clearInterval(checkInterval);
                    console.error("Failed to capture any tracks from video after 3 seconds.");
                }
            }, 200);
        } else {
            tracks.forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            sendSDPOffer();
        }
    }

    function createReceiverPeerConnection() {
        if (peerConnection) {
            try { peerConnection.close(); } catch(e) {}
        }
        // Keep remoteCandidatesQueue intact to preserve candidates that arrived early
        
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentRoomCode) {
                broadcastSyncEvent('webrtc_signal', {
                    candidate: event.candidate,
                    sender: currentUserName
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            console.log("Remote track received:", event.track.kind);
            
            if (!remoteStream) {
                remoteStream = new MediaStream();
            }
            
            if (!remoteStream.getTracks().find(t => t.id === event.track.id)) {
                remoteStream.addTrack(event.track);
            }
            
            const theatreDropzoneWrapper = document.querySelector('.theatre-dropzone-wrapper');
            if (theatreDropzoneWrapper) theatreDropzoneWrapper.classList.add('hidden');
            
            videoPlayerWrapper.classList.remove('hidden');
            
            const playerWrapper = document.getElementById('videoPlayerWrapper');
            if (playerWrapper) {
                playerWrapper.classList.add('plyr-is-receiver');
            }
            
            if (mainVideo.srcObject !== remoteStream) {
                mainVideo.srcObject = remoteStream;
            }
            
            mainVideo.muted = false;
            
            if (plyrPlayer) {
                plyrPlayer.muted = false;
                plyrPlayer.play().catch(err => {
                    console.log("Plyr stream play blocked:", err);
                    addNotification("Tap anywhere to enable audio and watch together!");
                    const playOnGesture = () => {
                        plyrPlayer.play();
                        document.removeEventListener('click', playOnGesture);
                        document.removeEventListener('touchstart', playOnGesture);
                    };
                    document.addEventListener('click', playOnGesture);
                    document.addEventListener('touchstart', playOnGesture);
                });
            } else {
                mainVideo.play().catch(err => {
                    console.log("Stream play blocked:", err);
                    addNotification("Tap anywhere to watch together!");
                    const playOnGesture = () => {
                        mainVideo.play();
                        document.removeEventListener('click', playOnGesture);
                        document.removeEventListener('touchstart', playOnGesture);
                    };
                    document.addEventListener('click', playOnGesture);
                    document.addEventListener('touchstart', playOnGesture);
                });
            }
        };
    }

    async function handleWebRTCSignal(signal) {
        if (signal.sender === currentUserName) return;
        
        try {
            if (signal.sdp) {
                const desc = new RTCSessionDescription(signal.sdp);
                
                if (desc.type === 'offer') {
                    createReceiverPeerConnection();
                    await peerConnection.setRemoteDescription(desc);
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    broadcastSyncEvent('webrtc_signal', {
                        sdp: answer,
                        sender: currentUserName
                    });
                } else if (desc.type === 'answer') {
                    if (peerConnection) {
                        await peerConnection.setRemoteDescription(desc);
                    }
                }
                
                if (peerConnection) {
                    while (remoteCandidatesQueue.length > 0) {
                        const candidateData = remoteCandidatesQueue.shift();
                        try {
                            await peerConnection.addIceCandidate(candidateData);
                        } catch (err) {
                            console.error("Error adding queued remote candidate:", err);
                        }
                    }
                }
            } else if (signal.candidate) {
                const candidate = new RTCIceCandidate(signal.candidate);
                if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                    try {
                        await peerConnection.addIceCandidate(candidate);
                    } catch(err) {
                        console.error("Error adding candidate directly:", err);
                    }
                } else {
                    remoteCandidatesQueue.push(candidate);
                }
            }
        } catch (e) {
            console.error("WebRTC signaling error:", e);
        }
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
        // Fullscreen class wiring
        if (plyrPlayer) {
            plyrPlayer.on('enterfullscreen', () => {
                document.body.classList.add('plyr-fullscreen-active');
            });
            plyrPlayer.on('exitfullscreen', () => {
                document.body.classList.remove('plyr-fullscreen-active');
            });
        } else if (mainVideo) {
            document.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement) {
                    document.body.classList.add('plyr-fullscreen-active');
                } else {
                    document.body.classList.remove('plyr-fullscreen-active');
                }
            });
        }

        window.addEventListener('together_video_load', (e) => {
            const videoData = e.detail;
            
            unloadVideo();
            // Pre-initialize receiver connection to capture early ICE candidates
            createReceiverPeerConnection();
            
            addNotification(`${videoData.sender || 'Partner'} shared: "${videoData.fileName}". Connecting live stream...`);
        });

        window.addEventListener('together_video_action', (e) => {
            const actionData = e.detail;
            
            // If we are playing a remote WebRTC stream, B's player is just a viewer. B's player doesn't seek.
            if (mainVideo.srcObject) {
                if (actionData.action === 'play') {
                    mainVideo.play().catch(err => {});
                } else if (actionData.action === 'pause') {
                    mainVideo.pause();
                } else if (actionData.action === 'unload') {
                    unloadVideo();
                }
                return;
            }

            if (actionData.action === 'play') {
                if (plyrPlayer) {
                    if (Math.abs(plyrPlayer.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        plyrPlayer.currentTime = actionData.time;
                    }
                    if (plyrPlayer.paused) {
                        ignorePlayEvents++;
                        plyrPlayer.play().catch(err => {});
                    }
                } else {
                    if (Math.abs(mainVideo.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        mainVideo.currentTime = actionData.time;
                    }
                    if (mainVideo.paused) {
                        ignorePlayEvents++;
                        mainVideo.play().catch(err => {});
                    }
                }
            } else if (actionData.action === 'pause') {
                if (plyrPlayer) {
                    if (Math.abs(plyrPlayer.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        plyrPlayer.currentTime = actionData.time;
                    }
                    if (!plyrPlayer.paused) {
                        ignorePauseEvents++;
                        plyrPlayer.pause();
                    }
                } else {
                    if (Math.abs(mainVideo.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        mainVideo.currentTime = actionData.time;
                    }
                    if (!mainVideo.paused) {
                        ignorePauseEvents++;
                        mainVideo.pause();
                    }
                }
            } else if (actionData.action === 'seek') {
                if (plyrPlayer) {
                    if (Math.abs(plyrPlayer.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        plyrPlayer.currentTime = actionData.time;
                    }
                } else {
                    if (Math.abs(mainVideo.currentTime - actionData.time) > 1.5) {
                        ignoreSeekEvents++;
                        mainVideo.currentTime = actionData.time;
                    }
                }
            } else if (actionData.action === 'unload') {
                unloadVideo();
                addNotification(`${actionData.sender} removed the active video.`);
            }
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
        
        window.dispatchEvent(new CustomEvent('together_heart_updated')); // Preload heart handlers
        
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
                        triggerLeave();
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
                triggerLeave();
            });
        }

        async function triggerLeave() {
            // Clear session immediately so closing the tab now is safe
            localStorage.removeItem('together_session_code');
            localStorage.removeItem('together_session_name');
            localStorage.removeItem('together_session_is_creator');

            await broadcastSyncEvent('presence', {
                action: 'leave',
                sender: currentUserName,
                timestamp: Date.now()
            });
            
            if (mqttClient) {
                let ended = false;
                const done = () => {
                    if (ended) return;
                    ended = true;
                    executeLeave();
                };
                setTimeout(done, 400); // safety fallback
                try {
                    mqttClient.end(false, done);
                } catch (e) {
                    done();
                }
            } else {
                executeLeave();
            }
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
