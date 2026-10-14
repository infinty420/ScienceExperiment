/**
 * SciLab W1 演示实验场景：网格实验台 + 可旋转立方体。
 * W2 起此文件将被"实验包加载器"替代（scene.json DSL -> 场景构建）。
 */
(function () {
  'use strict';

  var engine = new SciLab.Engine(document.getElementById('canvas'));
  window.__engine = engine;

  // ---- 场景构建 ----

  // 网格地面（实验台）
  var grid = new THREE.GridHelper(20, 20, 0x3d5266, 0x273543);
  grid.position.y = 0;
  engine.scene.add(grid);

  // 实验台面板
  var bench = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.25, 4),
    new THREE.MeshStandardMaterial({ color: 0x2e4051, roughness: 0.85 })
  );
  bench.position.set(0, 0.125, 0);
  engine.scene.add(bench);

  // 主角：立方体（W1 桥接演示对象）
  var cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x3f8f79, roughness: 0.4, metalness: 0.1 })
  );
  cube.position.set(0, 0.85, 0);
  engine.scene.add(cube);

  // 边框线（线框模式切换用）
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
      // 轻微悬浮感
      cube.position.y = 0.85 + Math.sin(cube.rotation.y * 2) * 0.06;
    }
  });

  // ---- 消息处理（原生 -> JS）----

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

  // 页面就绪后通知 HUD
  var hud = document.getElementById('hud');
  hud.textContent = 'SciLab Engine W1 | three r' + THREE.REVISION;

  // 若宿主在 JS 加载完成前就发送过消息，这里补发一次就绪信号
  SciLab.post('engine.ready', {
    engine: 'SciLab-Web',
    three: THREE.REVISION,
    scene: 'w1.demo'
  });
})();
