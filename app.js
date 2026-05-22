// ==========================================
// Together - Lover's Space, Chat & Synchronized Video Theatre
// ==========================================

document.addEventListener('DOMContentLoaded', () => {

    let currentRoomCode = null;
    let currentUserName = null;
    let isCreator = false;
    let timerTickInterval = null;

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
                // If it doesn't exist yet, we initialize as creator (temporary, will sync when creator enters)
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

            // 3. Header badge presence display & Partner Action Visibility Sync
            const headerUserBadge = document.getElementById('headerUserBadge');
            const badgeLoversNames = document.getElementById('badgeLoversNames');
            const chatPresenceIndicator = document.getElementById('chatPresenceIndicator');
            
            const btnLeaveSpace = document.getElementById('btnLeaveSpace');
            const btnSendChat = document.getElementById('btnSendChat');
            const chatInput = document.getElementById('chatInput');

            if (headerUserBadge && badgeLoversNames) {
                if (creator && partner) {
                    badgeLoversNames.textContent = `${creator} & ${partner}`;
                    if (chatPresenceIndicator) {
                        chatPresenceIndicator.textContent = "Partner Connected";
                        chatPresenceIndicator.style.color = "var(--accent)";
                    }

                    // Show Send and Leave buttons when partner is connected
                    if (btnLeaveSpace) btnLeaveSpace.classList.remove('hidden');
                    if (btnSendChat) btnSendChat.classList.remove('hidden');
                    if (chatInput) {
                        chatInput.disabled = false;
                        chatInput.placeholder = "Send a sweet message...";
                    }

                    // Track Connection Start Time
                    const startKey = `together_connection_start_${code}`;
                    let startTime = localStorage.getItem(startKey);
                    if (!startTime) {
                        startTime = Date.now().toString();
                        localStorage.setItem(startKey, startTime);
                    }
                    
                    // Render "Connected since [formattedTime]"
                    const connectionBadgeTime = document.getElementById('connectionBadgeTime');
                    if (connectionBadgeTime) {
                        const startDate = new Date(parseInt(startTime));
                        const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        connectionBadgeTime.textContent = `Connected since ${timeStr}`;
                        connectionBadgeTime.classList.remove('hidden');
                    }
                } else {
                    // Alone or waiting - show Waiting...
                    badgeLoversNames.textContent = "Waiting...";
                    if (chatPresenceIndicator) {
                        chatPresenceIndicator.textContent = "Waiting for partner...";
                        chatPresenceIndicator.style.color = "var(--text-muted)";
                    }

                    // Hide Send and Leave buttons when alone/waiting
                    if (btnLeaveSpace) btnLeaveSpace.classList.add('hidden');
                    if (btnSendChat) btnSendChat.classList.add('hidden');
                    if (chatInput) {
                        chatInput.disabled = true;
                        chatInput.placeholder = "Waiting for partner to connect...";
                    }
                    
                    // Hide connection time badge when alone
                    const connectionBadgeTime = document.getElementById('connectionBadgeTime');
                    if (connectionBadgeTime) {
                        connectionBadgeTime.classList.add('hidden');
                    }
                    
                    // Auto-fill roles if empty and we are entering
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
    function enterRoom(code, yourName) {
        currentRoomCode = code;
        currentUserName = yourName;
        headerRoomBadge.textContent = `Room Code: ${code}`;
        
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

        addNotification(`Connected to Room ${code}! Welcome, ${yourName}.`);
        
        loginScreen.classList.remove('active');
        setTimeout(() => {
            loginScreen.style.display = 'none';
            appScreen.classList.remove('hidden');
        }, 500);
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
        enterRoom(code, name);
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
            
            enterRoom(code, name);
        }
    });

    // ==========================================
    // --- 2. Creator Toggle Action Listeners ---
    // ==========================================
    const creatorShareToggle = document.getElementById('creatorShareToggle');
    if (creatorShareToggle) {
        creatorShareToggle.addEventListener('change', () => {
            if (currentRoomCode) {
                const permissionKey = `together_share_permission_${currentRoomCode}`;
                localStorage.setItem(permissionKey, creatorShareToggle.checked ? 'true' : 'false');
                addNotification(creatorShareToggle.checked ? "Partner allowed to share videos" : "Partner sharing permissions locked");
            }
        });
    }

    // ==========================================
    // --- 3. Lover's Chat synchronization ---
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

        // Initial render & listener
        renderChat();
        window.addEventListener('storage', (e) => {
            if (e.key === chatKey) {
                renderChat();
            }
        });
    }



    // ==========================================
    // --- 5. Gallery Video Player Logic ---
    // ==========================================
    const videoDropzone = document.getElementById('videoDropzone');
    const videoFileInput = document.getElementById('videoFileInput');
    const btnSelectVideo = document.getElementById('btnSelectVideo');
    const videoPlayerWrapper = document.getElementById('videoPlayerWrapper');
    const mainVideo = document.getElementById('mainVideo');

    // Custom Controls & Overlays References
    const btnVideoPlayPause = document.getElementById('btnVideoPlayPause');
    const videoTimeDisplay = document.getElementById('videoTimeDisplay');
    const btnVideoMute = document.getElementById('btnVideoMute');
    const videoVolume = document.getElementById('videoVolume');
    const btnVideoFullscreen = document.getElementById('btnVideoFullscreen');
    const btnChangeVideo = document.getElementById('btnChangeVideo');
    const videoProgress = document.getElementById('videoProgress');

    const brightnessOverlay = document.getElementById('brightnessOverlay');
    const btnCenterPlayPause = document.getElementById('btnCenterPlayPause');
    const btnUnlockOverlay = document.getElementById('btnUnlockOverlay');
    const btnUnlockControls = document.getElementById('btnUnlockControls');
    const leftIndicator = document.getElementById('leftIndicator');
    const leftIndicatorFill = document.getElementById('leftIndicatorFill');
    const leftIndicatorText = document.getElementById('leftIndicatorText');
    const rightIndicator = document.getElementById('rightIndicator');
    const rightIndicatorFill = document.getElementById('rightIndicatorFill');
    const rightIndicatorText = document.getElementById('rightIndicatorText');
    const seekIndicator = document.getElementById('seekIndicator');
    const seekIndicatorTime = document.getElementById('seekIndicatorTime');
    const seekIndicatorDiff = document.getElementById('seekIndicatorDiff');
    const customVideoControls = document.getElementById('customVideoControls');
    const btnLockControls = document.getElementById('btnLockControls');

    // Helper to format time into MM:SS
    function formatTime(secs) {
        if (isNaN(secs) || secs === null || secs === undefined) return '0:00';
        const mins = Math.floor(secs / 60);
        const remainingSecs = Math.floor(secs % 60).toString().padStart(2, '0');
        return `${mins}:${remainingSecs}`;
    }

    // Auto-Hide Controls Logic
    let hideControlsTimeout = null;
    let controlsLocked = false;

    function showControls() {
        if (controlsLocked) return;
        customVideoControls.classList.remove('hidden-controls');
        resetHideControlsTimeout();
    }

    function hideControls() {
        if (mainVideo.paused) return; // Stay visible when paused
        customVideoControls.classList.add('hidden-controls');
    }

    function resetHideControlsTimeout() {
        clearTimeout(hideControlsTimeout);
        if (mainVideo.paused || controlsLocked) return;
        hideControlsTimeout = setTimeout(hideControls, 3000);
    }

    // Bind controls wake-up events
    videoPlayerWrapper.addEventListener('mousemove', () => {
        showControls();
    });

    customVideoControls.addEventListener('mousemove', (e) => {
        e.stopPropagation();
        showControls();
    });

    // Lock / Unlock Controls Functionality
    if (btnLockControls) {
        btnLockControls.addEventListener('click', (e) => {
            e.stopPropagation();
            controlsLocked = true;
            customVideoControls.classList.add('hidden-controls');
            btnUnlockOverlay.classList.remove('hidden');
            addNotification("Controls locked. Tap padlock to unlock.");
        });
    }

    if (btnUnlockControls) {
        btnUnlockControls.addEventListener('click', (e) => {
            e.stopPropagation();
            controlsLocked = false;
            btnUnlockOverlay.classList.add('hidden');
            showControls();
            addNotification("Controls unlocked.");
        });
    }

    // Center Pulse Play/Pause Animations
    function showCenterPlayPauseAnimation(isPlaying) {
        if (!btnCenterPlayPause) return;
        if (isPlaying) {
            btnCenterPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        } else {
            btnCenterPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        }
        
        btnCenterPlayPause.classList.remove('hidden');
        btnCenterPlayPause.style.opacity = '1';
        btnCenterPlayPause.style.transform = 'translate(-50%, -50%) scale(1)';
        
        setTimeout(() => {
            btnCenterPlayPause.style.opacity = '0';
            btnCenterPlayPause.style.transform = 'translate(-50%, -50%) scale(1.3)';
            setTimeout(() => {
                btnCenterPlayPause.classList.add('hidden');
            }, 300);
        }, 500);
    }

    // Unified Double Tap & Single Tap Handler
    let tapTimeout = null;
    let lastTapTime = 0;

    function handleVideoTap(e) {
        if (e.target.closest('.custom-video-controls') || e.target.closest('#btnChangeVideo') || e.target.closest('#btnUnlockControls')) {
            return;
        }

        const now = Date.now();
        const delay = 300;

        if (now - lastTapTime < delay) {
            // Double Tap / Double Click detected
            clearTimeout(tapTimeout);
            lastTapTime = 0;
            togglePlayPause();
        } else {
            // Single Tap / Single Click detected
            lastTapTime = now;
            tapTimeout = setTimeout(() => {
                if (controlsLocked) {
                    // Flash unlock padlock briefly to nudge the user
                    btnUnlockOverlay.style.transform = "scale(1.2)";
                    setTimeout(() => btnUnlockOverlay.style.transform = "scale(1)", 200);
                    return;
                }
                
                // Toggle controls visibility
                if (customVideoControls.classList.contains('hidden-controls')) {
                    showControls();
                } else {
                    hideControls();
                }
            }, delay);
        }
    }

    videoPlayerWrapper.addEventListener('click', handleVideoTap);

    function togglePlayPause() {
        if (controlsLocked) return;
        
        if (mainVideo.paused) {
            mainVideo.play();
            btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
            broadcastVideoAction('play', mainVideo.currentTime);
            showCenterPlayPauseAnimation(true);
        } else {
            mainVideo.pause();
            btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            broadcastVideoAction('pause', mainVideo.currentTime);
            showCenterPlayPauseAnimation(false);
        }
        showControls();
    }

    // MX Player Gesture Engine (Vertical brightness/volume and Horizontal seek)
    let isDragging = false;
    let dragType = null; // 'seek', 'volume', 'brightness'
    let startX = 0;
    let startY = 0;
    let initialVolume = 1;
    let initialBrightness = 1;
    let initialTime = 0;
    let targetTime = 0;

    function getBrightness() {
        const opacity = parseFloat(brightnessOverlay.style.opacity) || 0;
        return 1 - opacity;
    }

    function setBrightness(brightness) {
        const opacity = 1 - brightness;
        brightnessOverlay.style.opacity = opacity;
    }

    function onDragStart(clientX, clientY) {
        if (controlsLocked) return;
        
        startX = clientX;
        startY = clientY;
        
        initialVolume = mainVideo.volume;
        initialBrightness = getBrightness();
        initialTime = mainVideo.currentTime;
        
        isDragging = false;
        dragType = null;
    }

    function onDragMove(clientX, clientY, e) {
        if (controlsLocked) return;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        if (!isDragging) {
            // Gesture activation thresholds
            if (Math.abs(deltaX) > 15 || Math.abs(deltaY) > 15) {
                isDragging = true;
                const rect = videoPlayerWrapper.getBoundingClientRect();
                const relX = startX - rect.left;
                
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    dragType = 'seek';
                } else {
                    if (relX < rect.width / 2) {
                        dragType = 'brightness';
                    } else {
                        dragType = 'volume';
                    }
                }
            }
        }
        
        if (isDragging) {
            e.preventDefault();
            const rect = videoPlayerWrapper.getBoundingClientRect();
            
            if (dragType === 'brightness') {
                const pct = -deltaY / rect.height; // Upward swipe increases brightness
                let targetBrightness = initialBrightness + pct;
                targetBrightness = Math.max(0.15, Math.min(1.0, targetBrightness));
                setBrightness(targetBrightness);
                
                // Update Left Pill Indicator UI
                leftIndicatorText.textContent = Math.round(targetBrightness * 100) + '%';
                leftIndicatorFill.style.height = (targetBrightness * 100) + '%';
                leftIndicator.classList.remove('hidden');
                leftIndicator.style.opacity = '1';
            }
            else if (dragType === 'volume') {
                const pct = -deltaY / rect.height; // Upward swipe increases volume
                let targetVolume = initialVolume + pct;
                targetVolume = Math.max(0.0, Math.min(1.0, targetVolume));
                mainVideo.volume = targetVolume;
                videoVolume.value = targetVolume;
                mainVideo.muted = (targetVolume === 0);
                updateVideoMuteIcon();
                
                // Update Right Pill Indicator UI
                rightIndicatorText.textContent = Math.round(targetVolume * 100) + '%';
                rightIndicatorFill.style.height = (targetVolume * 100) + '%';
                rightIndicator.classList.remove('hidden');
                rightIndicator.style.opacity = '1';
            }
            else if (dragType === 'seek') {
                // Dragging full width sweeps up to 300 seconds (or video duration)
                const seekRange = Math.min(300, mainVideo.duration || 100);
                const ratio = deltaX / rect.width;
                const deltaSecs = Math.round(ratio * seekRange);
                targetTime = initialTime + deltaSecs;
                targetTime = Math.max(0, Math.min(mainVideo.duration || 0, targetTime));
                
                // Update Seek Banner UI
                const dir = deltaSecs >= 0 ? '⏩' : '⏪';
                seekIndicator.querySelector('.seek-indicator-direction').textContent = dir;
                seekIndicatorTime.textContent = `${formatTime(targetTime)} / ${formatTime(mainVideo.duration)}`;
                seekIndicatorDiff.textContent = `(${deltaSecs >= 0 ? '+' : ''}${deltaSecs}s)`;
                seekIndicator.classList.remove('hidden');
                seekIndicator.style.opacity = '1';
            }
            
            showControls(); // Wake controls on active interaction
        }
    }

    function onDragEnd() {
        if (controlsLocked) return;
        
        if (isDragging) {
            if (dragType === 'seek') {
                mainVideo.currentTime = targetTime;
                broadcastVideoAction('seek', targetTime);
            }
            
            // Graceful fade-out transitions
            setTimeout(() => {
                leftIndicator.style.opacity = '0';
                rightIndicator.style.opacity = '0';
                seekIndicator.style.opacity = '0';
                setTimeout(() => {
                    leftIndicator.classList.add('hidden');
                    rightIndicator.classList.add('hidden');
                    seekIndicator.classList.add('hidden');
                }, 200);
            }, 300);
        }
        
        isDragging = false;
        dragType = null;
    }

    // Touch Event Registrations
    videoPlayerWrapper.addEventListener('touchstart', (e) => {
        if (e.target.closest('.custom-video-controls') || e.target.closest('#btnChangeVideo') || e.target.closest('#btnUnlockControls')) return;
        const touch = e.touches[0];
        onDragStart(touch.clientX, touch.clientY);
    }, { passive: true });

    videoPlayerWrapper.addEventListener('touchmove', (e) => {
        if (!isDragging && e.target.closest('.custom-video-controls')) return;
        const touch = e.touches[0];
        onDragMove(touch.clientX, touch.clientY, e);
    }, { passive: false });

    videoPlayerWrapper.addEventListener('touchend', () => {
        onDragEnd();
    });

    // Mouse Event Registrations
    let isMouseDown = false;
    videoPlayerWrapper.addEventListener('mousedown', (e) => {
        if (e.target.closest('.custom-video-controls') || e.target.closest('#btnChangeVideo') || e.target.closest('#btnUnlockControls')) return;
        isMouseDown = true;
        onDragStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        onDragMove(e.clientX, e.clientY, e);
    });

    window.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            onDragEnd();
        }
    });

    // Beautiful Public High-Fidelity royalty-free preview videos
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
            videoDropzone.style.background = 'rgba(216, 27, 96, 0.05)';
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
        mainVideo.src = fileUrl;
        
        videoDropzone.classList.add('hidden');
        videoPlayerWrapper.classList.remove('hidden');
        
        // Reset brightness/volume values
        setBrightness(1.0);
        mainVideo.volume = 1.0;
        videoVolume.value = 1.0;
        
        mainVideo.play();
        btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        
        btnVideoFullscreen.classList.remove('hidden');
        addNotification(`Shared video: ${file.name}`);
        showControls();

        if (triggerBroadcast && currentRoomCode) {
            const videoKey = `together_video_${currentRoomCode}`;
            const cdnUrl = CDN_PREVIEW_VIDEOS[Math.floor(Math.random() * CDN_PREVIEW_VIDEOS.length)];
            
            localStorage.setItem(videoKey, JSON.stringify({
                fileName: file.name,
                action: 'load',
                videoUrl: cdnUrl,
                sender: currentUserName,
                timestamp: Date.now()
            }));
        }
    }

    // Play/Pause Control Button Click
    btnVideoPlayPause.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
    });

    // Time/Progress Tracking
    mainVideo.addEventListener('timeupdate', () => {
        if (mainVideo.duration) {
            const percent = (mainVideo.currentTime / mainVideo.duration) * 100;
            videoProgress.value = percent;
            videoTimeDisplay.textContent = `${formatTime(mainVideo.currentTime)} / ${formatTime(mainVideo.duration)}`;
        }
    });

    videoProgress.addEventListener('input', () => {
        if (mainVideo.duration) {
            const time = (videoProgress.value / 100) * mainVideo.duration;
            mainVideo.currentTime = time;
            broadcastVideoAction('seek', time);
            showControls();
        }
    });

    // Volume Adjustment
    videoVolume.addEventListener('input', () => {
        mainVideo.volume = videoVolume.value;
        mainVideo.muted = (videoVolume.value == 0);
        updateVideoMuteIcon();
        showControls();
    });

    btnVideoMute.addEventListener('click', (e) => {
        e.stopPropagation();
        mainVideo.muted = !mainVideo.muted;
        updateVideoMuteIcon();
        showControls();
    });

    function updateVideoMuteIcon() {
        if (mainVideo.muted || mainVideo.volume == 0) {
            btnVideoMute.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v6a3 3 0 0 0 3 3H9l-5 4v-4H2V8h2L9 4v5z"></path></svg>';
        } else {
            btnVideoMute.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
        }
    }

    // Fullscreen Toggle
    btnVideoFullscreen.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mainVideo.requestFullscreen) {
            mainVideo.requestFullscreen();
        } else if (mainVideo.webkitRequestFullscreen) {
            mainVideo.webkitRequestFullscreen();
        }
    });

    // Unload / Change Video
    btnChangeVideo.addEventListener('click', (e) => {
        e.stopPropagation();
        unloadVideo();
        broadcastVideoAction('unload', 0);
    });

    function unloadVideo() {
        mainVideo.pause();
        mainVideo.src = "";
        videoPlayerWrapper.classList.add('hidden');
        videoDropzone.classList.remove('hidden');
        videoFileInput.value = "";
        btnVideoFullscreen.classList.add('hidden');
        controlsLocked = false;
        btnUnlockOverlay.classList.add('hidden');
    }

    // Shared Video Sync (Sync play/pause/seeks and Takeover)
    function broadcastVideoAction(action, time) {
        if (currentRoomCode) {
            const syncKey = `together_video_action_${currentRoomCode}`;
            localStorage.setItem(syncKey, JSON.stringify({
                action: action,
                time: time,
                sender: currentUserName,
                timestamp: Date.now()
            }));
        }
    }

    function startVideoSync(code) {
        const videoKey = `together_video_${code}`;
        const syncKey = `together_video_action_${code}`;

        window.addEventListener('storage', (e) => {
            if (e.key === videoKey) {
                let videoData = null;
                try {
                    videoData = JSON.parse(localStorage.getItem(videoKey));
                } catch(err) {}

                if (videoData && videoData.sender !== currentUserName) {
                    if (videoData.action === 'load') {
                        mainVideo.src = videoData.videoUrl;
                        videoDropzone.classList.add('hidden');
                        videoPlayerWrapper.classList.remove('hidden');
                        
                        setBrightness(1.0);
                        mainVideo.volume = 1.0;
                        videoVolume.value = 1.0;
                        
                        mainVideo.play();
                        btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
                        
                        btnVideoFullscreen.classList.remove('hidden');
                        addNotification(`${videoData.sender} shared: "${videoData.fileName}" (Syncing Preview)`);
                        showControls();
                    }
                }
            }

            if (e.key === syncKey) {
                let actionData = null;
                try {
                    actionData = JSON.parse(localStorage.getItem(syncKey));
                } catch(err) {}

                if (actionData && actionData.sender !== currentUserName) {
                    if (actionData.action === 'play') {
                        mainVideo.currentTime = actionData.time;
                        mainVideo.play();
                        btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
                        showControls();
                    } else if (actionData.action === 'pause') {
                        mainVideo.currentTime = actionData.time;
                        mainVideo.pause();
                        btnVideoPlayPause.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
                        showControls();
                    } else if (actionData.action === 'seek') {
                        mainVideo.currentTime = actionData.time;
                        showControls();
                    } else if (actionData.action === 'unload') {
                        unloadVideo();
                        addNotification(`${actionData.sender} removed the active video.`);
                    }
                }
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
            });
        });

        // Storage sync listener
        window.addEventListener('storage', (e) => {
            if (e.key === themeKey) {
                applyTheme(e.newValue || 'burgundy');
            }
        });
    }

    // ==========================================
    // --- Heart Burst Double Tap Synchronization ---
    // ==========================================
    function startHeartSync(code) {
        const heartTriggerKey = `together_heart_trigger_${code}`;
        
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
            if (controlsLocked) return;
            if (e.target.closest('.custom-video-controls') || e.target.closest('#btnChangeVideo') || e.target.closest('#btnUnlockControls')) return;
            
            const now = Date.now();
            if (now - lastTap < 300) {
                localStorage.setItem(heartTriggerKey, Date.now().toString());
                spawnHeartsLocal();
            }
            lastTap = now;
        });

        videoPlayerWrapper.addEventListener('touchstart', (e) => {
            if (controlsLocked) return;
            if (e.target.closest('.custom-video-controls') || e.target.closest('#btnChangeVideo') || e.target.closest('#btnUnlockControls')) return;
            
            const now = Date.now();
            if (now - lastTap < 300) {
                localStorage.setItem(heartTriggerKey, Date.now().toString());
                spawnHeartsLocal();
            }
            lastTap = now;
        });
        
        window.addEventListener('storage', (e) => {
            if (e.key === heartTriggerKey) {
                spawnHeartsLocal();
            }
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
            const roomKey = `together_room_${code}`;
            const startKey = `together_connection_start_${code}`;
            
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
            
            window.location.reload();
        }
    }

    // ==========================================
    // --- 6. Helper Utilities ---
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
        toast.style.boxShadow = '0 8px 30px rgba(216, 27, 96, 0.4)';
        toast.style.fontFamily = 'var(--font-body)';
        toast.style.fontSize = '0.9rem';
        toast.style.fontWeight = '500';
        toast.innerText = msg;
        
        document.body.appendChild(toast);
        
        // Dynamic slide-up
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
