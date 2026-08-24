/** AI 참여자 닉네임 후보. 사람 이름과 헷갈리지 않게 앞에 표시를 붙여 둔다. */
const AI_NAME_POOL = [
  '또박이', '붓손이', '동글이', '삐뚤이', '색연필', '찍찍이',
  '네모난', '세모난', '반달이', '먹물이', '분필이', '크레용',
  '지우개', '점선이', '물감이', '스케치', '낙서왕', '연필심',
  '팔레트', '데생이', '캔버스', '선긋기', '색칠이', '밑그림',
  '윤곽이', '명암이', '붓터치', '드로잉', '채색이', '화백님'
];

/** 방에 이미 있는 닉네임을 피해 새 이름을 고른다. 후보가 다 차면 번호를 붙인다. */
export const pickAiNickname = (used: Set<string>): string => {
  for (const name of AI_NAME_POOL) {
    const candidate = `AI ${name}`;
    if (!used.has(candidate)) return candidate;
  }
  for (let index = 1; index <= 100; index += 1) {
    const candidate = `AI ${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `AI ${Date.now() % 100000}`;
};
