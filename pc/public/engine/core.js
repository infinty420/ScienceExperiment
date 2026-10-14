/**
 * SciLab 3D Engine - Core
 * 平台无关核心：渲染器、场景管理、相机控制、桥消息分发。
 * 禁止调用任何平台专属 API（多端规范）。
 */
var SciLab = (function () {
  'use strict';

  // ---------- 桥协议 ----------
  // 原生 -> JS : window.__engine.onMessage(jsonString)
  // JS -> 原生 : nativeBridge.onMessage(jsonString)  (由宿主注入)

  var MSG_SEQ = 0;

  function makeMsg(type, payload, msgId) {
    return JSON.stringify({
      msgId: msgId !== undefined ? msgId : ('js-' + (++MSG_SEQ)),
      type: type,
      payload: payload || {}
    });
  }

  function post(type, payload, msgId) {
    var s = makeMsg(type, payload, msgId);
    try {
      if (window.nativeBridge && window.nativeBridge.onMessage) {
        window.nativeBridge.onMessage(s);
      } else {
        console.log('[bridge->native] ' + s);
      }
    } catch (e) {
      console.error('bridge post error: ' + e);
    }
  }

  // ---------- 引擎主体 ----------
  function Engine(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x1a2430, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a2430, 18, 60);

    this.camera = new THREE.PerspectiveCamera(
      50, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
    this.camera.position.set(5, 4.5, 7);
    this.camera.lookAt(0, 0.8, 0);

    // 灯光
    var hemi = new THREE.HemisphereLight(0xdfeaf2, 0x22303c, 0.85);
    this.scene.add(hemi);
    var dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(6, 10, 4);
    this.scene.add(dir);

    this.clock = new THREE.Clock();
    this.updatables = [];      // 每帧回调 (dt) => {}
    this.handlers = {};        // 消息类型 -> handler(payload, msgId)
    this.running = true;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    this._bindEvents();
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  Engine.prototype._bindEvents = function () {
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });

    // 单指旋转 / 双指缩放（触屏与鼠标统一）
    var touch = { rotating: false, lastX: 0, lastY: 0, pinch: 0 };
    var down = function (x, y) {
      touch.rotating = true; touch.lastX = x; touch.lastY = y;
    };
    var move = function (x, y) {
      if (!touch.rotating) return;
      var dx = x - touch.lastX, dy = y - touch.lastY;
      touch.lastX = x; touch.lastY = y;
      self.orbit(dx * 0.005, dy * 0.005);
    };
    var up = function () { touch.rotating = false; };

    this.canvas.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', up);

    this.canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        down(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        touch.pinch = self._pinchDist(e.touches);
      }
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) {
        move(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        var d = self._pinchDist(e.touches);
        if (touch.pinch > 0) {
          self.zoom(touch.pinch / d);
        }
        touch.pinch = d;
      }
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchend', up);

    // 滚轮缩放（PC）
    this.canvas.addEventListener('wheel', function (e) {
      self.zoom(e.deltaY > 0 ? 1.1 : 0.9);
      e.preventDefault();
    }, { passive: false });
  };

  Engine.prototype._pinchDist = function (touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 环绕相机：绕 Y 旋转 + 俯仰（限制角度）
  Engine.prototype.orbit = function (dx, dy) {
    var p = this.camera.position;
    var r = Math.sqrt(p.x * p.x + p.z * p.z);
    var theta = Math.atan2(p.z, p.x) - dx;
    var phi = Math.atan2(p.y - 0.8, r) - dy;
    phi = Math.max(-0.2, Math.min(1.35, phi));
    var hr = Math.max(2, Math.sqrt(r * r + (p.y - 0.8) * (p.y - 0.8)));
    p.x = Math.cos(theta) * hr * Math.cos(phi);
    p.z = Math.sin(theta) * hr * Math.cos(phi);
    p.y = 0.8 + hr * Math.sin(phi);
    this.camera.lookAt(0, 0.8, 0);
  };

  Engine.prototype.zoom = function (factor) {
    var p = this.camera.position;
    var target = new THREE.Vector3(0, 0.8, 0);
    var v = p.clone().sub(target);
    var len = Math.max(2.5, Math.min(30, v.length() * factor));
    v.setLength(len);
    p.copy(target).add(v);
    this.camera.lookAt(target);
  };

  Engine.prototype.resetCamera = function () {
    this.camera.position.set(5, 4.5, 7);
    this.camera.lookAt(0, 0.8, 0);
  };

  Engine.prototype.resize = function () {
    var w = this.canvas.clientWidth || window.innerWidth;
    var h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Engine.prototype._loop = function () {
    requestAnimationFrame(this._loop);
    if (!this.running) return;
    var dt = this.clock.getDelta();

    // FPS 统计
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 1.0) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0;
      this._fpsTime = 0;
      post('fps', { fps: this.fps });
    }

    for (var i = 0; i < this.updatables.length; i++) {
      this.updatables[i](dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  // 注册消息处理器与每帧回调（实验场景用）
  Engine.prototype.on = function (type, handler) {
    this.handlers[type] = handler;
  };

  Engine.prototype.onMessage = function (jsonString) {
    var msg;
    try {
      msg = JSON.parse(jsonString);
    } catch (e) {
      console.error('bad message: ' + jsonString);
      return;
    }
    var h = this.handlers[msg.type];
    if (h) {
      h(msg.payload || {}, msg.msgId);
    } else {
      post('error', { reason: 'unknown type: ' + msg.type }, msg.msgId);
    }
  };

  // 全局入口（原生侧调用 window.__engine.onMessage(...)）
  window.__engine = null;

  return {
    Engine: Engine,
    post: post
  };
})();
