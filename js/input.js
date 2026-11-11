// 입력: Pointer Events(마우스/터치 통합) + 키보드. click 이벤트는 쓰지 않는다.
(function (global) {
  'use strict';

  const BB = global.BB;

  // 숫자 키패드 배열 + 노트북용 QWE/ASD/ZXC (e.code 기준이라 한글 입력 상태에서도 동작)
  const KEY_CELLS = {};
  const rows = [
    ['7', '8', '9', 'KeyQ', 'KeyW', 'KeyE'],
    ['4', '5', '6', 'KeyA', 'KeyS', 'KeyD'],
    ['1', '2', '3', 'KeyZ', 'KeyX', 'KeyC'],
  ];
  rows.forEach((keys, row) => {
    keys.forEach((k, i) => {
      const col = i % 3;
      if (k.startsWith('Key')) KEY_CELLS[k] = { row, col };
      else {
        KEY_CELLS['Digit' + k] = { row, col };
        KEY_CELLS['Numpad' + k] = { row, col };
      }
    });
  });

  // handlers: { onPointerDown(x, y, timeStamp, pointerType), onPointerMove(x, y, pointerType), onCellKey(cell, timeStamp), onKey(code) }
  function attachInput(canvas, renderer, handlers) {
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = renderer.toLogical(e.clientX, e.clientY);
      handlers.onPointerDown(p.x, p.y, e.timeStamp, e.pointerType);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = renderer.toLogical(e.clientX, e.clientY);
      handlers.onPointerMove(p.x, p.y, e.pointerType);
    });
    canvas.addEventListener('pointerleave', () => handlers.onPointerMove(-1, -1, 'mouse'));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    global.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const cell = KEY_CELLS[e.code];
      if (cell) {
        e.preventDefault();
        handlers.onCellKey(cell, e.timeStamp);
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') {
        e.preventDefault();
        handlers.onKey(e.code === 'NumpadEnter' ? 'Enter' : e.code);
      }
    });
  }

  Object.assign(BB, { attachInput });
})(window);
