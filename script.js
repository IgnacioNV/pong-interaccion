(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var canvasWrapEl = document.getElementById('canvas-wrap');

  var WIDTH = 800;
  var HEIGHT = 500;

  var PADDLE_W = 12;
  var PADDLE_H = 80;
  var PADDLE_MARGIN = 22;
  var PLAYER_X = PADDLE_MARGIN;
  var CPU_X = WIDTH - PADDLE_MARGIN - PADDLE_W;

  var KEYBOARD_SPEED = 520;

  var DIFFICULTIES = {
    facil: { maxSpeed: 210, errorRange: 95, errorInterval: 0.9 },
    normal: { maxSpeed: 270, errorRange: 60, errorInterval: 0.7 },
    dificil: { maxSpeed: 330, errorRange: 38, errorInterval: 0.55 }
  };
  var currentDifficulty = 'normal';

  var MAX_BOUNCE_ANGLE = 55 * Math.PI / 180;
  var PADDLE_HIT_SPEEDUP = 1.03;
  var BASE_BALL_SPEED = 380;

  var WIN_SCORE = 5;

  var FIRE_BALL_CHANCE = 0.18;
  var FIRE_SPEED_MULT = 1.6;
  var FIRE_TRAIL_LENGTH = 14;

  var STREAK_AURA_THRESHOLD = 3;
  var STREAK_RESET_AT = 5;
  var AURA_SPEED_MULT = 1.25;
  var STREAK_DOTS = 5;

  var RALLY_FIRE_TIME = 10;
  var RALLY_BOOST_MULT = 1.3;

  var OVAL_SPIN_RATE = 0.09;
  var OVAL_WALL_CHAOS = 32 * Math.PI / 180;

  var SERVE_COUNTDOWN = 3;

  var BALL_VARIANTS = [
    {
      key: 'normal', name: 'Normal', icon: '●',
      rx: 8, ry: 8, speedMult: 1, angleNoise: 0, color: '#f2f2f7'
    },
    {
      key: 'grande', name: 'Grande', icon: '⬤',
      rx: 17, ry: 17, speedMult: 0.78, angleNoise: 3 * Math.PI / 180, color: '#8be28b'
    },
    {
      key: 'chica', name: 'Chica', icon: '•',
      rx: 5, ry: 5, speedMult: 1.35, angleNoise: 18 * Math.PI / 180, color: '#ffe066'
    },
    {
      key: 'ovalada', name: 'Ovalada', icon: '⬮',
      rx: 15, ry: 7, speedMult: 1.08, angleNoise: 24 * Math.PI / 180, color: '#c792ea'
    }
  ];

  // ---- Audio (sintetizado, sin archivos externos) ----
  var audioCtx = null;
  var fireNoiseSource = null;
  var fireLfo = null;
  var fireGain = null;

  function ensureAudioCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playTone(opts) {
    var ctxA = ensureAudioCtx();
    if (!ctxA) return;
    var start = ctxA.currentTime + (opts.delay || 0);
    var dur = opts.duration || 0.12;
    var osc = ctxA.createOscillator();
    var gain = ctxA.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), start + dur);
    }
    var vol = opts.volume != null ? opts.volume : 0.2;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(ctxA.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  var WALL_SOUNDS = {
    normal: { freq: 480, type: 'sine', duration: 0.07, volume: 0.18 },
    grande: { freq: 220, type: 'sine', duration: 0.12, volume: 0.2 },
    chica: { freq: 900, type: 'square', duration: 0.05, volume: 0.1 },
    ovalada: { freq: 650, freqEnd: 320, type: 'triangle', duration: 0.1, volume: 0.16 }
  };

  function playWallSound(variantKey) {
    playTone(WALL_SOUNDS[variantKey] || WALL_SOUNDS.normal);
  }

  function playPaddleSound() {
    playTone({ freq: 300, freqEnd: 150, type: 'square', duration: 0.07, volume: 0.22 });
  }

  function playScoreSound(who) {
    if (who === 'player') {
      playTone({ freq: 523, type: 'sine', duration: 0.11, volume: 0.25 });
      playTone({ freq: 784, type: 'sine', duration: 0.18, volume: 0.25, delay: 0.09 });
    } else {
      playTone({ freq: 392, type: 'triangle', duration: 0.13, volume: 0.25 });
      playTone({ freq: 262, type: 'triangle', duration: 0.22, volume: 0.25, delay: 0.1 });
    }
  }

  function playCountdownTick(isGo) {
    playTone({
      freq: isGo ? 700 : 440,
      type: 'sine',
      duration: isGo ? 0.18 : 0.09,
      volume: 0.16
    });
  }

  function startFireSound() {
    var ctxA = ensureAudioCtx();
    if (!ctxA || fireNoiseSource) return;

    var bufferSize = 2 * ctxA.sampleRate;
    var buffer = ctxA.createBuffer(1, bufferSize, ctxA.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    var noise = ctxA.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    var filter = ctxA.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.7;

    var gain = ctxA.createGain();
    gain.gain.value = 0.045;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctxA.destination);
    noise.start();

    var lfo = ctxA.createOscillator();
    lfo.frequency.value = 7;
    var lfoGain = ctxA.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();

    fireNoiseSource = noise;
    fireLfo = lfo;
    fireGain = gain;
  }

  function stopFireSound() {
    if (fireNoiseSource) {
      try { fireNoiseSource.stop(); } catch (e) { /* already stopped */ }
      fireNoiseSource.disconnect();
      fireNoiseSource = null;
    }
    if (fireLfo) {
      try { fireLfo.stop(); } catch (e) { /* already stopped */ }
      fireLfo.disconnect();
      fireLfo = null;
    }
    if (fireGain) {
      fireGain.disconnect();
      fireGain = null;
    }
  }

  var playerScoreEl = document.getElementById('player-score');
  var cpuScoreEl = document.getElementById('cpu-score');
  var playerScoreDotsEl = document.getElementById('player-score-dots');
  var cpuScoreDotsEl = document.getElementById('cpu-score-dots');
  var ballIconEl = document.getElementById('ball-icon');
  var ballNameEl = document.getElementById('ball-name');
  var ballIndicatorEl = document.getElementById('ball-indicator');
  var rallyTimerEl = document.getElementById('rally-timer');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  var difficultyBtns = document.querySelectorAll('.difficulty-btn');

  difficultyBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentDifficulty = btn.getAttribute('data-difficulty');
      difficultyBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });

  function updateRallyTimer() {
    if (state.ball && state.ball.boosted) {
      rallyTimerEl.textContent = '🔥 ¡Fuego!';
      return;
    }
    var remaining = Math.max(0, RALLY_FIRE_TIME - state.rallyTime);
    rallyTimerEl.textContent = '⏱ ' + Math.ceil(remaining) + 's';
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 1600);
  }
  var playerStreakEl = document.getElementById('player-streak');
  var cpuStreakEl = document.getElementById('cpu-streak');
  var startScreen = document.getElementById('start-screen');
  var endScreen = document.getElementById('end-screen');
  var endTitle = document.getElementById('end-title');
  var endScoreText = document.getElementById('end-score');
  var startBtn = document.getElementById('start-btn');
  var restartBtn = document.getElementById('restart-btn');

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  var state = {
    screen: 'start', // 'start' | 'playing' | 'end'
    player: { y: HEIGHT / 2 - PADDLE_H / 2, score: 0, streak: 0 },
    cpu: {
      y: HEIGHT / 2 - PADDLE_H / 2,
      score: 0,
      streak: 0,
      targetError: 0,
      errorTimer: 0
    },
    ball: null,
    elapsed: 0,
    rallyTime: 0,
    countdownRemaining: 0,
    countdownLastTick: 0
  };

  // ---- Input ----
  var inputMode = 'mouse';
  var mouseY = HEIGHT / 2;
  var keys = { up: false, down: false };

  canvas.addEventListener('mousemove', function (e) {
    inputMode = 'mouse';
    var rect = canvas.getBoundingClientRect();
    mouseY = (e.clientY - rect.top) * (HEIGHT / rect.height);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      inputMode = 'keyboard';
      if (e.key === 'ArrowUp') keys.up = true;
      else keys.down = true;
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowUp') keys.up = false;
    if (e.key === 'ArrowDown') keys.down = false;
  });

  function updatePlayerPaddle(dt) {
    if (inputMode === 'mouse') {
      state.player.y = clamp(mouseY - PADDLE_H / 2, 0, HEIGHT - PADDLE_H);
    } else {
      var dy = 0;
      if (keys.up) dy -= KEYBOARD_SPEED * dt;
      if (keys.down) dy += KEYBOARD_SPEED * dt;
      state.player.y = clamp(state.player.y + dy, 0, HEIGHT - PADDLE_H);
    }
  }

  // ---- CPU AI ----
  function updateCpuPaddle(dt) {
    var cpu = state.cpu;
    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    cpu.errorTimer -= dt;
    if (cpu.errorTimer <= 0) {
      cpu.errorTimer = diff.errorInterval;
      cpu.targetError = (Math.random() * 2 - 1) * diff.errorRange;
    }
    var target = state.ball.y + cpu.targetError - PADDLE_H / 2;
    var delta = target - cpu.y;
    var maxStep = diff.maxSpeed * dt;
    var step = clamp(delta, -maxStep, maxStep);
    cpu.y = clamp(cpu.y + step, 0, HEIGHT - PADDLE_H);
  }

  // ---- Ball ----
  function pickVariant() {
    return BALL_VARIANTS[Math.floor(Math.random() * BALL_VARIANTS.length)];
  }

  function updateBallIndicator(variant, fire) {
    ballIconEl.textContent = variant.icon + (fire ? ' 🔥' : '');
    ballIconEl.style.color = fire ? '#ffb347' : variant.color;
    ballNameEl.textContent = variant.name;
    ballIndicatorEl.classList.toggle('fire', fire);
  }

  function makeBall(direction, variant, fire) {
    var angle = (Math.random() * 0.6 - 0.3);
    var speed = BASE_BALL_SPEED * variant.speedMult * (fire ? FIRE_SPEED_MULT : 1);
    return {
      x: WIDTH / 2,
      y: HEIGHT / 2,
      rx: variant.rx,
      ry: variant.ry,
      variant: variant,
      fire: fire,
      trail: [],
      spinAngle: 0,
      boosted: false,
      vx: Math.cos(angle) * speed * direction,
      vy: Math.sin(angle) * speed
    };
  }

  function resetBall() {
    var direction = Math.random() < 0.5 ? -1 : 1;
    var variant = pickVariant();
    var fire = Math.random() < FIRE_BALL_CHANCE;
    updateBallIndicator(variant, fire);
    state.ball = makeBall(direction, variant, fire);
    state.rallyTime = 0;
    rallyTimerEl.classList.remove('boost');
    updateRallyTimer();
  }

  function paddleBounce(ball, paddle, paddleX, side, incomingVx, incomingVy) {
    // side: 1 = player paddle (front faces +x), -1 = cpu paddle (front faces -x)
    var relative = (ball.y - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2);
    relative = clamp(relative, -1, 1);
    var angle = relative * MAX_BOUNCE_ANGLE;
    var variant = ball.variant;

    if (variant.key === 'ovalada') {
      var ratio = clamp(incomingVy / Math.max(Math.abs(incomingVx), 1), -2.5, 2.5);
      angle += ratio * 0.18;
      angle += Math.sin(ball.spinAngle) * 0.3;
    }
    if (variant.angleNoise > 0) {
      angle += (Math.random() * 2 - 1) * variant.angleNoise;
    }
    angle = clamp(angle, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

    var speed = Math.hypot(incomingVx, incomingVy) * PADDLE_HIT_SPEEDUP;
    if (paddle.streak >= STREAK_AURA_THRESHOLD) speed *= AURA_SPEED_MULT;
    ball.vx = Math.cos(angle) * speed * side;
    ball.vy = Math.sin(angle) * speed;
  }

  function sweptPaddleCheck(ball, prevX, prevY, paddle, paddleX, side) {
    // side: 1 -> player paddle, ball travelling left (vx<0), front edge at paddleX+PADDLE_W
    // side: -1 -> cpu paddle, ball travelling right (vx>0), front edge at paddleX
    var plane = side === 1 ? paddleX + PADDLE_W + ball.rx : paddleX - ball.rx;
    if (side === 1 && !(prevX >= plane && ball.x < plane)) return false;
    if (side === -1 && !(prevX <= plane && ball.x > plane)) return false;

    var dx = ball.x - prevX;
    if (dx === 0) return false;
    var t = (plane - prevX) / dx;
    if (t < 0 || t > 1) return false;
    var yAtPlane = prevY + (ball.y - prevY) * t;

    if (yAtPlane + ball.ry < paddle.y || yAtPlane - ball.ry > paddle.y + PADDLE_H) {
      return false;
    }

    ball.x = plane;
    ball.y = yAtPlane;
    return true;
  }

  function updateBall(dt) {
    var ball = state.ball;
    var prevX = ball.x;
    var prevY = ball.y;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.fire) {
      ball.trail.unshift({ x: ball.x, y: ball.y });
      if (ball.trail.length > FIRE_TRAIL_LENGTH) ball.trail.length = FIRE_TRAIL_LENGTH;
    }

    if (ball.variant && ball.variant.key === 'ovalada') {
      ball.spinAngle += Math.hypot(ball.vx, ball.vy) * OVAL_SPIN_RATE * dt;
    }

    // Top / bottom walls
    var hitWall = false;
    if (ball.y - ball.ry < 0) {
      ball.y = ball.ry;
      ball.vy = Math.abs(ball.vy);
      hitWall = true;
    } else if (ball.y + ball.ry > HEIGHT) {
      ball.y = HEIGHT - ball.ry;
      ball.vy = -Math.abs(ball.vy);
      hitWall = true;
    }

    if (hitWall) {
      playWallSound(ball.variant.key);
    }

    if (hitWall && ball.variant && ball.variant.key === 'ovalada') {
      var wallSpeed = Math.hypot(ball.vx, ball.vy);
      var wallAngle = Math.atan2(ball.vy, ball.vx) + (Math.random() * 2 - 1) * OVAL_WALL_CHAOS;
      ball.vx = Math.cos(wallAngle) * wallSpeed;
      ball.vy = Math.sin(wallAngle) * wallSpeed;
    }

    state.rallyTime += dt;
    if (!ball.boosted && state.rallyTime >= RALLY_FIRE_TIME) {
      ball.boosted = true;
      ball.vx *= RALLY_BOOST_MULT;
      ball.vy *= RALLY_BOOST_MULT;
      if (!ball.fire) {
        ball.fire = true;
        updateBallIndicator(ball.variant, true);
      }
      rallyTimerEl.classList.add('boost');
      showToast('¡LA PELOTA SE PRENDIÓ FUEGO!');
    }
    updateRallyTimer();

    var incomingVx = ball.vx;
    var incomingVy = ball.vy;

    if (ball.vx < 0 && sweptPaddleCheck(ball, prevX, prevY, state.player, PLAYER_X, 1)) {
      paddleBounce(ball, state.player, PLAYER_X, 1, incomingVx, incomingVy);
      playPaddleSound();
    } else if (ball.vx > 0 && sweptPaddleCheck(ball, prevX, prevY, state.cpu, CPU_X, -1)) {
      paddleBounce(ball, state.cpu, CPU_X, -1, incomingVx, incomingVy);
      playPaddleSound();
    }

    if (ball.x + ball.rx < 0) {
      awardPoint('cpu');
    } else if (ball.x - ball.rx > WIDTH) {
      awardPoint('player');
    }
  }

  function awardPoint(who) {
    var other = who === 'player' ? 'cpu' : 'player';
    var wasFire = !!(state.ball && state.ball.fire);
    state[who].score += wasFire ? 2 : 1;

    state[who].streak += 1;
    state[other].streak = 0;
    if (state[who].streak >= STREAK_RESET_AT) state[who].streak = 0;

    updateScoreboard();
    updateStreakUI();
    playScoreSound(who);
    if (wasFire) showToast('¡PUNTO DOBLE!');

    if (checkWin()) return;
    startServe();
  }

  function startServe() {
    resetBall();
    state.screen = 'countdown';
    state.countdownRemaining = SERVE_COUNTDOWN;
    state.countdownLastTick = SERVE_COUNTDOWN;
  }

  function renderStreakDots(el, count, sideClass) {
    el.innerHTML = '';
    for (var i = 0; i < STREAK_DOTS; i++) {
      var dot = document.createElement('span');
      dot.className = 'streak-dot' + (i < count ? ' lit ' + sideClass : '');
      el.appendChild(dot);
    }
  }

  function updateStreakUI() {
    renderStreakDots(playerStreakEl, state.player.streak, 'player-lit');
    renderStreakDots(cpuStreakEl, state.cpu.streak, 'cpu-lit');
  }

  function checkWin() {
    if (state.player.score >= WIN_SCORE) {
      endGame('player');
      return true;
    }
    if (state.cpu.score >= WIN_SCORE) {
      endGame('cpu');
      return true;
    }
    return false;
  }

  function popScore(el, value) {
    if (el.textContent === String(value)) return;
    el.textContent = value;
    el.classList.remove('pop');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // restart animation
    el.classList.add('pop');
  }

  function renderScoreDots(el, score, sideClass) {
    el.innerHTML = '';
    var count = Math.min(score, WIN_SCORE);
    for (var i = 0; i < WIN_SCORE; i++) {
      var dot = document.createElement('span');
      dot.className = 'score-dot' + (i < count ? ' filled ' + sideClass : '');
      el.appendChild(dot);
    }
  }

  function updateScoreboard() {
    popScore(playerScoreEl, state.player.score);
    popScore(cpuScoreEl, state.cpu.score);
    renderScoreDots(playerScoreDotsEl, state.player.score, 'player-fill');
    renderScoreDots(cpuScoreDotsEl, state.cpu.score, 'cpu-fill');
  }

  // ---- Screens / flow ----
  function startGame() {
    ensureAudioCtx();
    state.player.score = 0;
    state.cpu.score = 0;
    state.player.streak = 0;
    state.cpu.streak = 0;
    state.player.y = HEIGHT / 2 - PADDLE_H / 2;
    state.cpu.y = HEIGHT / 2 - PADDLE_H / 2;
    state.cpu.errorTimer = 0;
    updateScoreboard();
    updateStreakUI();
    startScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
    startServe();
  }

  function endGame(winner) {
    state.screen = 'end';
    endTitle.textContent = winner === 'player' ? '¡Ganaste!' : 'Perdiste';
    endScoreText.textContent = state.player.score + ' - ' + state.cpu.score;
    endScreen.classList.remove('hidden');
  }

  function showStartScreen() {
    state.screen = 'start';
    endScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', showStartScreen);

  // ---- Rendering ----
  function isBallOnFire() {
    return !!(state.ball && state.ball.fire && (state.screen === 'playing' || state.screen === 'countdown'));
  }

  function drawCourt() {
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (isBallOnFire()) {
      var pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 8);
      ctx.strokeStyle = 'rgba(255, ' + Math.round(90 + pulse * 50) + ', 20, ' + (0.5 + pulse * 0.5) + ')';
      ctx.lineWidth = 6 + pulse * 6;
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, WIDTH - ctx.lineWidth, HEIGHT - ctx.lineWidth);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 0);
    ctx.lineTo(WIDTH / 2, HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCountdown() {
    if (state.screen !== 'countdown') return;
    var n = Math.max(1, Math.ceil(state.countdownRemaining));
    var frac = state.countdownRemaining - (n - 1);
    var scale = 0.85 + 0.35 * frac;

    ctx.save();
    ctx.translate(WIDTH / 2, HEIGHT / 2);
    ctx.scale(scale, scale);
    ctx.font = '900 130px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#4ad6ff';
    ctx.shadowBlur = 30;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  function drawPaddle(x, y, color, auraActive) {
    ctx.save();
    if (auraActive) {
      var pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 6);
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 + pulse * 16;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
    ctx.restore();
  }

  function drawFireTrail(ball) {
    var n = ball.trail.length;
    for (var i = n - 1; i >= 0; i--) {
      var p = ball.trail[i];
      var frac = 1 - i / n;
      var r = Math.max(ball.rx, ball.ry) * (0.25 + 0.7 * frac);
      ctx.globalAlpha = frac * 0.45;
      ctx.fillStyle = '#ff7a33';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBall(ball) {
    if (ball.fire && ball.trail.length) drawFireTrail(ball);

    ctx.save();
    if (ball.fire) {
      ctx.shadowColor = '#ff6a2f';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffb347';
    } else {
      ctx.fillStyle = ball.variant ? ball.variant.color : '#f2f2f7';
    }
    var rotation = (ball.variant && ball.variant.key === 'ovalada') ? ball.spinAngle : 0;
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, ball.rx, ball.ry, rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    drawCourt();
    drawPaddle(PLAYER_X, state.player.y, '#4ad6ff', state.player.streak >= STREAK_AURA_THRESHOLD);
    drawPaddle(CPU_X, state.cpu.y, '#ff5d73', state.cpu.streak >= STREAK_AURA_THRESHOLD);
    if (state.ball) drawBall(state.ball);
    drawCountdown();
  }

  // ---- Main loop ----
  var lastTime = null;

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    state.elapsed += dt;

    if (state.screen === 'countdown') {
      updatePlayerPaddle(dt);
      updateCpuPaddle(dt);
      state.countdownRemaining -= dt;
      var currentTick = Math.ceil(state.countdownRemaining);
      if (currentTick !== state.countdownLastTick && currentTick >= 0) {
        state.countdownLastTick = currentTick;
        if (currentTick > 0) playCountdownTick(false);
      }
      if (state.countdownRemaining <= 0) {
        state.screen = 'playing';
        playCountdownTick(true);
      }
    } else if (state.screen === 'playing') {
      updatePlayerPaddle(dt);
      updateCpuPaddle(dt);
      updateBall(dt);
    }

    if (isBallOnFire()) {
      canvasWrapEl.classList.add('fire-active');
      startFireSound();
    } else {
      canvasWrapEl.classList.remove('fire-active');
      stopFireSound();
    }

    render();
    requestAnimationFrame(frame);
  }

  updateScoreboard();
  updateStreakUI();
  render();
  requestAnimationFrame(frame);
})();
