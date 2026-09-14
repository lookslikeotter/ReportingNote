// 봉누도2 — 등급 체크 보드 만들기. 쓰는 법: node .github/scripts/grade-board.js (볼트 루트에서). private/등급 체크.md를 다시 만든다.
// private/등급 체크.md — 사건마다 취재가치를 드롭다운(Meta Bind inlineSelect)으로 고르는 보드
const fs=require("fs"),path=require("path");
const ROOT="01 일지/사건";
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p,o):p.endsWith(".md")&&o.push(p);}return o;}
const fm=(t,k)=>{const m=t.match(new RegExp("^"+k+": (.*)$","m"));return m?m[1].trim().replace(/^"|"$/g,""):"";};
const files=walk(ROOT).sort((a,b)=>a.localeCompare(b,"ko"));
const byDay={};
for(const f of files){const t=fs.readFileSync(f,"utf8");const name=path.basename(f,".md");const m=name.match(/^(\d+)일차-(\d+)(?:-(\d+))? (.*)$/);if(!m)continue;
 const day=+m[1];const key=[+m[2],m[3]===undefined?0:+m[3]];const isParent=/^하위사건:/m.test(t);
 (byDay[day]??=[]).push({name,title:m[4],key,isParent,sub:m[3]!==undefined,grade:fm(t,"취재가치"),time:fm(t,"시간"),tags:fm(t,"tags")});}
const sel=name=>"`INPUT[inlineSelect(option(☕ 일상), option(📰 사건), option(🔥 특종)):[["+name+"]]#취재가치]`";
let out=`---
type: 보드
tags: [보류]
---
> [!info] 사이트에 올라가지 않는 노트
> 사건마다 **취재가치**를 여기서 바로 고른다. 드롭다운은 **Meta Bind** 플러그인이 켜져 있어야 보인다 (설정 → 커뮤니티 플러그인 → Meta Bind).
> 고른 값은 그 사건 노트의 \`취재가치\` 속성에 바로 저장된다. 다 고른 뒤 Claude에게 "커밋해 줘"라고 하면 태그(\`사건\`·\`특종\`)와 일지 표의 띠를 값에 맞춰 정리해서 올린다.
> 큰 사건은 하위 등급과 상관없이 흐름 전체를 보고 매긴다. 이벤트 태그가 있는 큰 사건은 표에서 📅로 표시되지만 취재가치 값은 따로 둔다.

`;
for(const day of Object.keys(byDay).map(Number).sort((a,b)=>a-b)){
 const rows=byDay[day].sort((a,b)=>a.key[0]-b.key[0]||a.key[1]-b.key[1]);
 out+=`## ${day}일차\n\n| 시간 | 사건 | 취재가치 |\n|---|---|---|\n`;
 for(const r of rows){const label=(r.sub?"↳ ":"")+"[["+r.name+"\\|"+r.title+"]]"+(r.isParent?" **(큰 사건)**":"")+(/이벤트/.test(r.tags)?" 📅":"");
  out+=`| ${r.time} | ${label} | ${sel(r.name)} |\n`;}
 out+="\n";
}
fs.mkdirSync("private",{recursive:true});fs.writeFileSync("private/등급 체크.md",out);
console.log("rows:",Object.values(byDay).reduce((a,b)=>a+b.length,0));
