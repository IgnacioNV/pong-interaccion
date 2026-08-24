(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var WIDTH = 800;
  var HEIGHT = 500;

  var PADDLE_W = 12;
  var PADDLE_H = 80;
  var PADDLE_MARGIN = 22;
  var PLAYER_X = PADDLE_MARGIN;
  var CPU_X = WIDTH - PADDLE_MARGIN - PADDLE_W;

  var KEYBOARD_SPEED = 520;
  var CPU_MAX_SPEED = 300;
  var CPU_ERROR_RANGE = 46;
  var CPU_ERROR_INTERVAL = 0.7;

  var MAX_BOUNCE_ANGLE = 55 * Math.PI / 180;
  var PADDLE_HIT_SPEEDUP = 1.03;
  var BASE_BALL_SPEED = 380;

  var WIN_SCORE = 11;
  var WIN_MARGIN = 2;

  var playerScoreEl = document.getElementById('player-score');
  var cpuScoreEl = document.getElementById('cpu-score');
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
    player: { y: HEIGHT / 2 - PADDLE_H / 2, score: 0 },
    cpu: {
      y: HEIGHT / 2 - PADDLE_H / 2,
      score: 0,
      targetError: 0,
      errorTimer: 0
    },
    ball: null
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
    cpu.errorTimer -= dt;
    if (cpu.errorTimer <= 0) {
      cpu.errorTimer = CPU_ERROR_INTERVAL;
      cpu.targetError = (Math.random() * 2 - 1) * CPU_ERROR_RANGE;
    }
    var target = state.ball.y + cpu.targetError - PADDLE_H / 2;
    var diff = target - cpu.y;
    var maxStep = CPU_MAX_SPEED * dt;
    var step = clamp(diff, -maxStep, maxStep);
    cpu.y = clamp(cpu.y + step, 0, HEIGHT - PADDLE_H);
  }

  // ---- Ball ----
  function makeBall(direction) {
    var angle = (Math.random() * 0.6 - 0.3);
    var speed = BASE_BALL_SPEED;
    return {
      x: WIDTH / 2,
      y: HEIGHT / 2,
      rx: 8,
      ry: 8,
      vx: Math.cos(angle) * speed * direction,
      vy: Math.sin(angle) * speed
    };
  }

  function resetBall() {
    var direction = Math.random() < 0.5 ? -1 : 1;
    state.ball = makeBall(direction);
  }

  function paddleBounce(ball, paddle, paddleX, side) {
    // side: 1 = player paddle (front faces +x), -1 = cpu paddle (front faces -x)
    var relative = (ball.y - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2);
    relative = clamp(relative, -1, 1);
    var angle = relative * MAX_BOUNCE_ANGLE;
    var speed = Math.hypot(ball.vx, ball.vy) * PADDLE_HIT_SPEEDUP;
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

    // Top / bottom walls
    if (ball.y - ball.ry < 0) {
      ball.y = ball.ry;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y + ball.ry > HEIGHT) {
      ball.y = HEIGHT - ball.ry;
      ball.vy = -Math.abs(ball.vy);
    }

    if (ball.vx < 0 && sweptPaddleCheck(ball, prevX, prevY, state.player, PLAYER_X, 1)) {
      paddleBounce(ball, state.player, PLAYER_X, 1);
    } else if (ball.vx > 0 && sweptPaddleCheck(ball, prevX, prevY, state.cpu, CPU_X, -1)) {
      paddleBounce(ball, state.cpu, CPU_X, -1);
    }

    if (ball.x + ball.rx < 0) {
      awardPoint('cpu');
    } else if (ball.x - ball.rx > WIDTH) {
      awardPoint('player');
    }
  }

  function awardPoint(who) {
    state[who].score += 1;
    updateScoreboard();

    if (checkWin()) return;
    resetBall();
  }

  function checkWin() {
    var p = state.player.score;
    var c = state.cpu.score;
    if (p >= WIN_SCORE && p - c >= WIN_MARGIN) {
      endGame('player');
      return true;
    }
    if (c >= WIN_SCORE && c - p >= WIN_MARGIN) {
      endGame('cpu');
      return true;
    }
    return false;
  }

  function updateScoreboard() {
    playerScoreEl.textContent = state.player.score;
    cpuScoreEl.textContent = state.cpu.score;
  }

  // ---- Screens / flow ----
  function startGame() {
    state.player.score = 0;
    state.cpu.score = 0;
    state.player.y = HEIGHT / 2 - PADDLE_H / 2;
    state.cpu.y = HEIGHT / 2 - PADDLE_H / 2;
    state.cpu.errorTimer = 0;
    updateScoreboard();
    resetBall();
    state.screen = 'playing';
    startScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
  }

  function endGame(winner) {
    state.screen = 'end';
    endTitle.textContent = winner === 'player' ? '¡Ganaste!' : 'Perdiste';
    endScoreText.textContent = state.player.score + ' - ' + state.cpu.score;
    endScreen.classList.remove('hidden');
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // ---- Rendering ----
  function drawCourt() {
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 0);
    ctx.lineTo(WIDTH / 2, HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPaddle(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
  }

  function drawBall(ball) {
    ctx.fillStyle = '#f2f2f7';
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, ball.rx, ball.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    drawCourt();
    drawPaddle(PLAYER_X, state.player.y, '#4ad6ff');
    drawPaddle(CPU_X, state.cpu.y, '#ff5d73');
    if (state.ball) drawBall(state.ball);
  }

  // ---- Main loop ----
  var lastTime = null;

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (state.screen === 'playing') {
      updatePlayerPaddle(dt);
      updateCpuPaddle(dt);
      updateBall(dt);
    }

    render();
    requestAnimationFrame(frame);
  }

  updateScoreboard();
  render();
  requestAnimationFrame(frame);
})();
