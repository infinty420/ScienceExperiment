/**
 * SciLab PC - W1 演示实验场景（自 rawfile/web/engine/main.js 迁移）。
 * 差异：包装为 boot 函数（Vue 挂载 canvas 后调用），支持重复进入。
 */
(function () {
  'use strict';

  function boot(canvas) {
    // 停掉上一个实验台实例的渲染循环
    if (window.__engine) {
      window.__engine.running = false;
    }

    var engine = new SciLab.Engine(canvas);
    window.__engine = engine;

    // ---- 场景构建 ----

    var grid = new THREE.GridHelper(20, 20, 0x3d5266, 0x273543);
    grid.position.y = 0;
    engine.scene.add(grid);

    var bench = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.25, 4),
      new THREE.MeshStandardMaterial({ color: 0x2e4051, roughness: 0.85 })
    );
    bench.position.set(0, 0.125, 0);
    engine.scene.add(bench);

    var cube = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x3f8f79, roughness: 0.4, metalness: 0.1 })
    );
    cube.position.set(0, 0.85, 0);
    engine.scene.add(cube);

    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: 0xaef0d8 })
    );
    cube.add(edges);

    var spinning = true;
    var spinSpeed = 1.0;

    engine.updatables.push(function (dt) {
      if (spinning) {
        cube.rotation.y += spinSpeed * dt;
        cube.rotation.x += spinSpeed * 0.35 * dt;
        cube.position.y = 0.85 + Math.sin(cube.rotation.y * 2) * 0.06;
      }
    });

    // ---- 消息处理（UI -> 引擎）----

    engine.on('engine.init', function (payload, msgId) {
      SciLab.post('engine.ready', {
        engine: 'SciLab-Web',
        three: THREE.REVISION,
        scene: 'w1.demo'
      }, msgId);
    });

    engine.on('scene.spin', function (payload) {
      spinning = !!(payload.on);
    });

    engine.on('scene.speed', function (payload) {
      var v = Number(payload.value);
      if (!isNaN(v)) spinSpeed = Math.max(0, Math.min(5, v));
      SciLab.post('scene.state', { speed: spinSpeed });
    });

    engine.on('scene.reset', function () {
      engine.resetCamera();
      cube.rotation.set(0, 0, 0);
      cube.position.set(0, 0.85, 0);
      spinning = true;
      spinSpeed = 1.0;
      SciLab.post('scene.state', { speed: spinSpeed, reset: true });
    });

    engine.on('scene.wireframe', function (payload) {
      cube.material.wireframe = !!(payload.on);
    });

    engine.on('scene.color', function (payload) {
      try {
        cube.material.color.setHex(payload.hex);
      } catch (e) { /* ignore */ }
    });
  }

  // 供 Vue 调用
  window.__scilabBootDemo = boot;

  // 直接 <script> 引入时（如鸿蒙 WebView），canvas 已存在则自动启动
  var auto = document.getElementById('canvas');
  if (auto) {
    boot(auto);
  }
})();
