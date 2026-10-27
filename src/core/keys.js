// 글자 단축키(E, Z) 판정. e.key는 입력된 글자라 한글 입력 상태에서는 E 키가 'ㄷ'이나 'Process'로 들어온다.
// e.key가 영문자이면 그 글자로 판정하고(Dvorak 같은 다른 배열도 표시된 글자대로), 아니면 물리 키 위치(e.code)로 판정한다.
export function isLetterKey(e, letter) {
  const key = e.key || '';
  if (/^[a-z]$/i.test(key)) return key.toLowerCase() === letter;
  return e.code === `Key${letter.toUpperCase()}`;
}
