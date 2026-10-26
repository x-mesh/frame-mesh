// 선형 실행 취소/다시 실행 이력. 연산 적용·복원은 호출자가 넘긴 함수가 담당한다.
export class History {
  constructor({ apply, revert, onChange }) {
    this.apply = apply;
    this.revert = revert;
    this.onChange = onChange;
    this.ops = [];
    this.cursor = 0;
  }

  get canUndo() {
    return this.cursor > 0;
  }

  get canRedo() {
    return this.cursor < this.ops.length;
  }

  get last() {
    return this.cursor > 0 ? this.ops[this.cursor - 1] : null;
  }

  get atEnd() {
    return this.cursor === this.ops.length;
  }

  clear() {
    this.ops = [];
    this.cursor = 0;
    this.onChange(null);
  }

  push(op) {
    this.ops.length = this.cursor;
    this.ops.push(op);
    this.cursor += 1;
    this.apply(op);
    this.onChange(op);
  }

  amendLast(patch) {
    if (!this.atEnd || !this.last) throw new Error('amendLast: 이력 끝에서만 수정할 수 있습니다.');
    Object.assign(this.last, patch);
    this.apply(this.last);
    this.onChange(this.last);
  }

  // 제스처 시작 시 밀어 넣은 연산을 변화 없이 끝냈을 때 이력에서 지운다.
  discardLast() {
    if (!this.atEnd || !this.last) return null;
    const op = this.ops.pop();
    this.cursor -= 1;
    this.revert(op);
    this.onChange(op);
    return op;
  }

  undo() {
    if (!this.canUndo) return null;
    this.cursor -= 1;
    const op = this.ops[this.cursor];
    this.revert(op);
    this.onChange(op);
    return op;
  }

  redo() {
    if (!this.canRedo) return null;
    const op = this.ops[this.cursor];
    this.cursor += 1;
    this.apply(op);
    this.onChange(op);
    return op;
  }

  goto(cursor) {
    const target = Math.max(0, Math.min(cursor, this.ops.length));
    while (this.cursor > target) this.undo();
    while (this.cursor < target) this.redo();
  }
}
