// 속성 패널과 엔진이 공유하는 편집 가능 속성 목록
// 라벨은 사전 키(labelKey)로 두고 화면에 그릴 때 번역한다. 묶음 비교에는 key를 쓴다.
import { t } from './i18n.js';

const SIDES = ['top', 'right', 'bottom', 'left'];

const px = (prop, labelKey) => ({ prop, labelKey, kind: 'px' });
const text = (prop, labelKey) => ({ prop, labelKey, kind: 'text' });
const color = (prop, labelKey) => ({ prop, labelKey, kind: 'color' });
const choice = (prop, labelKey, options) => ({ prop, labelKey, kind: 'select', options });

export const PROP_GROUPS = [
  { key: 'padding', fields: SIDES.map((s) => px(`padding-${s}`, `side.${s}`)) },
  { key: 'margin', fields: SIDES.map((s) => px(`margin-${s}`, `side.${s}`)) },
  { key: 'size', fields: [px('width', 'field.width'), px('height', 'field.height'), px('min-width', 'field.minWidth'), px('max-width', 'field.maxWidth'), px('min-height', 'field.minHeight'), px('gap', 'field.gap')] },
  { key: 'position', fields: [choice('position', 'field.position', ['static', 'relative', 'absolute', 'fixed', 'sticky']), px('left', 'field.left'), px('top', 'field.top'), px('right', 'field.right'), px('bottom', 'field.bottom')] },
  { key: 'text', single: true, fields: [{ prop: 'font-family', labelKey: 'field.fontFamily', kind: 'font' }, { ...px('font-size', 'field.fontSize'), scale: true }, text('letter-spacing', 'field.letterSpacing'), text('line-height', 'field.lineHeight'), choice('font-weight', 'field.fontWeight', ['400', '500', '600', '700']), choice('text-align', 'field.textAlign', ['left', 'center', 'right', 'justify'])] },
  { key: 'color', single: true, fields: [color('color', 'field.color'), color('background-color', 'field.backgroundColor')] },
  { key: 'border', single: true, fields: [px('border-radius', 'field.borderRadius'), px('border-width', 'field.borderWidth'), color('border-color', 'field.borderColor')] },
  { key: 'layout', single: true, fields: [choice('display', 'field.display', ['block', 'flex', 'grid', 'inline-block', 'inline-flex', 'none']), choice('flex-direction', 'field.flexDirection', ['row', 'column', 'row-reverse', 'column-reverse']), choice('justify-content', 'field.justifyContent', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']), choice('align-items', 'field.alignItems', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'])] },
];

// 문구 변경을 속성 변경과 같은 목록에 담을 때 쓰는 내부 키. 화면에는 번역한 라벨로 보인다.
export const TEXT_PROP = '#text';

export const ALL_PROPS = PROP_GROUPS.flatMap((g) => g.fields.map((f) => f.prop));
export const groupTitle = (group) => t(`group.${group.key}`);
export const fieldLabel = (field) => t(field.labelKey);
