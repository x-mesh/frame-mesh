// 속성 패널과 엔진이 공유하는 편집 가능 속성 목록
const SIDES = ['top', 'right', 'bottom', 'left'];
const SIDE_LABELS = { top: '상', right: '우', bottom: '하', left: '좌' };

const px = (prop, label) => ({ prop, label, kind: 'px' });
const text = (prop, label) => ({ prop, label, kind: 'text' });
const color = (prop, label) => ({ prop, label, kind: 'color' });
const choice = (prop, label, options) => ({ prop, label, kind: 'select', options });

export const PROP_GROUPS = [
  { title: '패딩', fields: SIDES.map((s) => px(`padding-${s}`, SIDE_LABELS[s])) },
  { title: '마진', fields: SIDES.map((s) => px(`margin-${s}`, SIDE_LABELS[s])) },
  { title: '크기', fields: [px('width', '너비'), px('height', '높이'), px('min-width', '최소 너비'), px('max-width', '최대 너비'), px('min-height', '최소 높이'), px('gap', '간격')] },
  { title: '위치', fields: [choice('position', '배치 방식', ['static', 'relative', 'absolute', 'fixed', 'sticky']), px('left', '왼쪽'), px('top', '위'), px('right', '오른쪽'), px('bottom', '아래')] },
  { title: '글자', single: true, fields: [{ prop: 'font-family', label: '글꼴', kind: 'font' }, { ...px('font-size', '크기'), scale: true }, text('letter-spacing', '자간'), text('line-height', '줄 높이'), choice('font-weight', '굵기', ['400', '500', '600', '700']), choice('text-align', '정렬', ['left', 'center', 'right', 'justify'])] },
  { title: '색', single: true, fields: [color('color', '글자색'), color('background-color', '배경색')] },
  { title: '테두리', single: true, fields: [px('border-radius', '모서리'), px('border-width', '두께'), color('border-color', '색')] },
  { title: '배치', single: true, fields: [choice('display', '표시 방식', ['block', 'flex', 'grid', 'inline-block', 'inline-flex', 'none']), choice('flex-direction', '방향', ['row', 'column', 'row-reverse', 'column-reverse']), choice('justify-content', '주축 정렬', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']), choice('align-items', '교차축 정렬', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'])] },
];

export const ALL_PROPS = PROP_GROUPS.flatMap((g) => g.fields.map((f) => f.prop));
