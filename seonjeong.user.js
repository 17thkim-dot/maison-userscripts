// ==UserScript==
// @name         체험단 선정 자동화 (메종원스이어)
// @namespace    maison-once-a-year
// @version      2.2
// @description  스타일씨 당첨자 선정 통합 + 담당자용 내보내기. v2.2: 중복팝업 '시간/분 전' 당첨도 0일로 인식(판독불가 스킵 해소). 1개월내 3회미만 선정.
// @match        https://stylec.co.kr/*
// @match        https://*.stylec.co.kr/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/seonjeong.user.js
// @downloadURL  https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/seonjeong.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ═════════ 설정 기본값 ═════════ */
  // 중복창일: '1개월'로 볼 일수(기본 30). 월허용횟수: 이 창 안에서 기존 당첨이 이 횟수 '미만'이면 선정 승인(기본 3 → 0~2회면 선정, 3회↑ 제외).
  const 기본 = { 중복창일: 30, 월허용횟수: 3, 취소상한: 3, 사유없음허용: true, 대상: '마감임박', 캠페인당상한: 0 };
  const KEY = 'mo_선정_상태';
  const 패널ID = 'mo-선정-패널';

  /* ═════════ 상태 ═════════ */
  const 읽기 = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || null; } catch (e) { return null; } };
  const 쓰기 = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const 초기상태 = () => ({ 모드: 'idle', 설정: Object.assign({}, 기본), 큐: [], 완료: [], 결과: [], 로그: [], 시작: '', _대기: 0 });
  let S = 읽기() || 초기상태();
  if (!S.설정.월허용횟수) S.설정 = Object.assign({}, 기본, S.설정);   // 구버전 상태 보정
  let 진행중 = false;

  /* ═════════ 유틸 ═════════ */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const 패널있음 = () => document.getElementById(패널ID);
  const 보임 = e => e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 &&
                   !(패널있음() && 패널있음().contains(e));
  const 텍 = e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
  const 클릭요소 = () => [...document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit],[onclick]')].filter(보임);
  const 포함찾기 = re => 클릭요소().filter(e => re.test(텍(e)))
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0] || null;
  const 대기 = async (fn, n = 24, ms = 500) => { for (let i = 0; i < n; i++) { const r = fn(); if (r) return r; await sleep(ms); } return null; };
  const 오늘 = () => new Date().toISOString().slice(0, 10);
  const 오늘0 = () => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; };

  const 저장 = (이름, 내용) => {
    try {
      const b = new Blob(['﻿' + 내용], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 이름;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { 기록('⚠ 파일 저장 실패: ' + e.message); }
  };

  /* ═════════ 화면 판별 ═════════ */
  const 목록버튼 = () => 클릭요소().filter(e => /^선정하기$/.test(텍(e)));
  const 카드버튼 = () => 클릭요소().filter(e => { const t = 텍(e); return t.length <= 8 && /^(선택하기|선택|선정|당첨하기|당첨)$/.test(t); });
  const 목록임 = () => 목록버튼().length >= 1 && /당첨자\s*선정/.test(document.body.innerText || '');
  const 상세임 = () => 카드버튼().length >= 1;

  /* ═════════ 로그 ═════════ */
  let 본문;
  const 그리기로그 = () => { if (본문) { 본문.textContent = S.로그.join('\n'); 본문.scrollTop = 본문.scrollHeight; } };
  const 기록 = (s) => { S.로그.push(s); if (S.로그.length > 500) S.로그.shift(); 쓰기(S); 그리기로그(); try { console.log(s); } catch (e) {} };

  /* ═════════ 패널 ═════════ */
  function 버튼CSS(bg, fg) {
    return 'font:inherit;font-size:11.5px;cursor:pointer;background:' + bg + ';color:' + fg + ';border:0;border-radius:3px;padding:5px 11px';
  }
  function 입력CSS() {
    return 'font:inherit;width:42px;background:#1c2521;color:#e2ebe7;border:1px solid #33413c;border-radius:3px;padding:2px 5px';
  }
  const 상태갱신 = () => {
    const el = document.getElementById('mo-st'); if (!el) return;
    el.textContent = S.모드 === 'run' ? '● 실행중 (' + S.완료.length + '건 완료)'
      : (목록임() ? '선정목록' : 상세임() ? '지원자' : /\d{16}A\d{6}/.test(document.body.innerText || '') ? '관리목록' : '대기');
    el.style.color = S.모드 === 'run' ? '#7fd8c6' : '#8fa39d';
  };

  const 패널만들기 = () => {
    if (패널있음()) return;
    const p = document.createElement('div');
    p.id = 패널ID;
    p.style.cssText = 'position:fixed;left:14px;bottom:14px;width:min(440px,44vw);z-index:2147483647;' +
      'background:#101614;color:#e2ebe7;border:1px solid #33413c;border-radius:8px;' +
      'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 14px 46px rgba(0,0,0,.5);' +
      'display:flex;flex-direction:column;overflow:hidden';
    p.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;padding:9px 11px;background:#18211e;border-bottom:1px solid #33413c;cursor:move">' +
        '<b style="flex:1;font-size:12.5px;color:#7fd8c6">체험단 선정 자동화</b>' +
        '<span id="mo-st" style="font-size:11px;color:#8fa39d"></span>' +
        '<button data-a="min" style="' + 버튼CSS('#2a3532', '#cbd6d2') + '">▾</button>' +
      '</div>' +
      '<div data-a="wrap" style="display:flex;flex-direction:column">' +
        '<div style="display:flex;gap:6px;padding:9px 11px;flex-wrap:wrap;border-bottom:1px solid #232e2b">' +
          '<button data-a="diag" style="' + 버튼CSS('#2a3532', '#dfe9e5') + '">진단</button>' +
          '<button data-a="dry" style="' + 버튼CSS('#2a3532', '#dfe9e5') + '">예행</button>' +
          '<button data-a="run" style="' + 버튼CSS('#1f6f66', '#fff') + '">▶ 실행</button>' +
          '<button data-a="stop" style="' + 버튼CSS('#8b3a32', '#fff') + '">■ 중지</button>' +
          '<span style="flex:1"></span>' +
          '<button data-a="save" style="' + 버튼CSS('#2a3532', '#dfe9e5') + '">결과 저장</button>' +
          '<button data-a="hand" style="' + 버튼CSS('#3a5f57', '#eafff9') + '">담당자용</button>' +
          '<button data-a="reset" style="' + 버튼CSS('#2a3532', '#8fa39d') + '">초기화</button>' +
        '</div>' +
        '<div style="display:flex;gap:9px;padding:8px 11px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #232e2b;font-size:11.5px;color:#9db0aa">' +
          '<label>중복창 <input data-a="win" type="number" min="1" style="' + 입력CSS() + '"> 일</label>' +
          '<label>1개월내 <input data-a="mon" type="number" min="0" style="' + 입력CSS() + '"> 회 미만 선정</label>' +
          '<label>취소상한 <input data-a="cancel" type="number" min="0" style="' + 입력CSS() + '"> 회</label>' +
          '<label>캠당 <input data-a="cap" type="number" min="0" style="' + 입력CSS() + '"></label>' +
          '<label><input data-a="all" type="checkbox"> 전체</label>' +
        '</div>' +
        '<pre data-a="body" style="margin:0;padding:10px 12px;height:236px;overflow:auto;white-space:pre-wrap;word-break:break-all"></pre>' +
      '</div>';
    document.body.appendChild(p);
    본문 = p.querySelector('[data-a=body]');

    /* 제목 줄 드래그 이동 */
    const 헤더 = p.firstElementChild;
    if (헤더)헤더.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      p.style.right = 'auto'; p.style.bottom = 'auto';
      const 이동 = ev => {
        let x = Math.max(0, Math.min(ev.clientX - dx, innerWidth - r.width));
        let y = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40));
        p.style.left = x + 'px'; p.style.top = y + 'px';
      };
      const 끝 = () => { document.removeEventListener('mousemove', 이동); document.removeEventListener('mouseup', 끝); };
      document.addEventListener('mousemove', 이동); document.addEventListener('mouseup', 끝);
    });

    const $ = a => p.querySelector('[data-a=' + a + ']');
    $('win').value = S.설정.중복창일; $('mon').value = S.설정.월허용횟수;
    $('cancel').value = S.설정.취소상한; $('cap').value = S.설정.캠페인당상한; $('all').checked = S.설정.대상 === '전체';
    const 설정읽기 = () => {
      S.설정.중복창일 = +$('win').value || 30;
      S.설정.월허용횟수 = Math.max(0, +$('mon').value || 0);
      S.설정.취소상한 = +$('cancel').value || 0;
      S.설정.캠페인당상한 = +$('cap').value || 0;
      S.설정.대상 = $('all').checked ? '전체' : '마감임박';
      쓰기(S);
    };
    ['win', 'mon', 'cancel', 'cap', 'all'].forEach(a => { $(a).onchange = 설정읽기; });

    const 두번클릭 = (btn, 안내, 실행fn, 원래bg) => {
      let armed = false, t = null, 원래라벨 = btn.textContent;
      btn.onclick = () => {
        if (!armed) {
          armed = true; 원래라벨 = btn.textContent;
          btn.textContent = '한번 더 ▶'; btn.style.background = '#8b3a32';
          기록('⚠ ' + 안내);
          t = setTimeout(() => { armed = false; btn.textContent = 원래라벨; btn.style.background = 원래bg; }, 4000);
          return;
        }
        clearTimeout(t); armed = false; btn.textContent = 원래라벨; btn.style.background = 원래bg; 실행fn();
      };
    };

    $('min').onclick = () => { const w = $('wrap'); w.style.display = w.style.display === 'none' ? 'flex' : 'none'; };
    $('diag').onclick = () => { 설정읽기(); 한번(false, false); };
    $('dry').onclick = () => { 설정읽기(); 한번(false, true); };
    두번클릭($('run'), '실제 선정을 시작합니다. 되돌릴 수 없습니다 — 4초 안에 「한번 더 ▶」를 누르세요.', () => {
      설정읽기();
      S.모드 = 'run'; S.완료 = []; S.결과 = []; S.로그 = []; S._대기 = 0; S.시작 = new Date().toLocaleString('ko-KR');
      쓰기(S); 기록('▶ 실행 시작 — ' + S.시작 + ' (이후 자동 진행)'); 틱();
    }, '#1f6f66');
    $('stop').onclick = () => { S.모드 = 'idle'; 쓰기(S); 진행중 = false; 기록('■ 중지했습니다.'); 상태갱신(); };
    $('save').onclick = () => 결과저장();
    $('hand').onclick = () => 담당자목록();
    두번클릭($('reset'), '진행 상황을 모두 지웁니다 — 4초 안에 「한번 더 ▶」를 누르세요.', () => {
      S = 초기상태(); 쓰기(S); $('win').value = S.설정.중복창일; $('mon').value = S.설정.월허용횟수;
      $('cancel').value = S.설정.취소상한; $('cap').value = S.설정.캠페인당상한; 그리기로그(); 상태갱신();
    }, '#2a3532');
    상태갱신(); 그리기로그();
  };

  /* ═════════ 선정목록(선정하기 버튼) 파싱 ═════════ */
  const 행수집 = () => 목록버튼().map(btn => {
    let n = btn, box = null;
    for (let d = 0; d < 10 && n && n.parentElement; d++) {
      n = n.parentElement; const t = n.innerText || '';
      if (/\d{16}A\d{6}/.test(t)) { box = n; if (t.length < 500) break; }
    }
    const t = box ? box.innerText : '';
    const 코드 = (t.match(/(\d{16}A\d{6})/) || [])[1] || '';
    const h = t.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
    const 상태 = /오늘까지\s*선정/.test(t) ? '오늘까지' : /당첨발표|발표일/.test(t) ? '발표일' : (t.match(/(\d+일\s*남음)/) || [])[1] || '기타';
    return { 코드, 상태, 등록: h ? +h[1] : 0, 모집: h ? +h[2] : 0, 선정됨: h ? +h[3] : 0, 버튼: btn };
  }).filter(r => r.코드);

  const 대상선별 = 행 => 행.filter(r => (S.설정.대상 === '전체' || r.상태 === '오늘까지' || r.상태 === '발표일') && r.선정됨 < r.모집 && r.등록 > r.선정됨);

  /* ═════════ 관리목록(캠페인 관리) 파싱 ═════════ */
  const 쿠키인가 = t => /쿠키/.test(t) && !/케이크/.test(t);
  const 코드박스 = 코드 => {
    let best = null;
    for (const el of document.querySelectorAll('div,li,tr,section,article')) {
      const t = el.innerText || '';
      if (t.includes(코드) && /\d+\s*\/\s*\d+\s*\/\s*\d+/.test(t) && t.length < 1300) {
        if (!best || t.length < (best.innerText || '').length) best = el;
      }
    }
    return best;
  };
  const 관리행수집 = () => {
    const codes = [...new Set((document.body.innerText.match(/\d{16}A\d{6}/g) || []))];
    return codes.map(코드 => {
      const box = 코드박스(코드); const t = box ? box.innerText : '';
      const h = t.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      const 상태 = /신청마감/.test(t) ? '신청마감' : /신청중/.test(t) ? '신청중' : /예정/.test(t) ? '예정' : /오늘까지/.test(t) ? '오늘까지' : /발표|당첨발표/.test(t) ? '발표일' : '기타';
      return { 코드, 상태, 등록: h ? +h[1] : 0, 모집: h ? +h[2] : 0, 선정됨: h ? +h[3] : 0, 쿠키: 쿠키인가(t), box };
    }).sort((a, b) => a.코드.localeCompare(b.코드));
  };
  const 선정필요 = r => r.모집 > 0 && r.선정됨 < r.모집 && r.등록 > r.선정됨;
  const 진입제외 = /^(수정|삭제|전체\s*자동검수|전체\s*내보내기|결과\s*레포트|.*리뷰\s*검수|닫기|이전|다음|\d+)$/;
  const 관리목록임 = () => 클릭요소().some(e => /^수정$/.test(텍(e))) && 클릭요소().some(e => /^삭제$/.test(텍(e)));
  const 선정액션버튼 = () => {
    const cands = 클릭요소().filter(e => /^당첨자\s*선정$/.test(텍(e)));
    if (!cands.length) return null;
    const 비사이드 = cands.filter(e => !e.closest('nav,aside') &&
      !/체험단\s*관리|체험단\s*레포트|반려\s*및\s*신고|1:1\s*문의|결제내역|정산\s*이력|공지사항/.test((e.parentElement && e.parentElement.innerText) || ''));
    const pool = 비사이드.length ? 비사이드 : [];
    return pool.find(e => e.tagName === 'BUTTON') || pool[0] || null;
  };
  const 진입버튼찾기 = box => {
    if (!box) return null;
    const 후보 = [...box.querySelectorAll('button,a,[role=button],[onclick]')].filter(보임);
    let e = 후보.find(el => /(당첨자\s*선정|선정하기|^선정$|당첨하기)/.test(텍(el)) && !진입제외.test(텍(el)));
    if (e) return e;
    e = 후보.find(el => el.tagName === 'A' && (el.getAttribute('href') || '').replace(/^#$/, '') && !진입제외.test(텍(el)));
    return e || null;
  };

  /* ═════════ 중복팝업: 경과일 목록 파싱 ═════════ */
  const 경과목록 = txt => {
    const d = [];
    (txt.match(/(\d+)\s*일\s*전/g) || []).forEach(m => d.push(+m.match(/\d+/)[0]));
    (txt.match(/(\d+)\s*주\s*전/g) || []).forEach(m => d.push(+m.match(/\d+/)[0] * 7));
    (txt.match(/(\d+)\s*개월\s*전/g) || []).forEach(m => d.push(+m.match(/\d+/)[0] * 30));
    (txt.match(/(\d+)\s*년\s*전/g) || []).forEach(m => d.push(+m.match(/\d+/)[0] * 365));
    (txt.match(/(\d+)\s*(?:시간|분|초)\s*전/g) || []).forEach(() => d.push(0));   // 시간/분/초 전 = 오늘(0일)
    if (/오늘/.test(txt)) d.push(0);
    if (/어제/.test(txt)) d.push(1);
    if (/방금|금방/.test(txt)) d.push(0);
    const now = 오늘0();
    let m; const reFull = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g;
    while ((m = reFull.exec(txt))) { const dt = new Date(+m[1], +m[2] - 1, +m[3]); dt.setHours(0, 0, 0, 0); const diff = Math.round((now - dt) / 86400000); if (diff >= 0 && diff <= 3650) d.push(diff); }
    return d;
  };
  const 승인버튼찾기 = () => 포함찾기(/중복\s*당첨\s*승인|당첨\s*승인|계속\s*진행/);
  const 다른버튼찾기 = () => 포함찾기(/다른\s*인플루언서\s*선정|이전\s*당첨\s*유지/);
  const 모달찾기 = () => {
    const b = 승인버튼찾기() || 다른버튼찾기();
    if (!b) return null;
    let n = b, box = b.parentElement;
    for (let i = 0; i < 10 && n; i++) {
      if (n.getAttribute && (n.getAttribute('role') === 'dialog' || /modal|popup|dialog|layer/i.test(n.className || ''))) { box = n; break; }
      const t = n.innerText || '';
      if (/당첨|이력/.test(t) && t.length < 1200) box = n;
      n = n.parentElement;
    }
    return box || b.parentElement || null;
  };

  /* ═════════ 지원자 처리 (지원자 화면) ═════════ */
  const 지원자처리 = async (실행, 정원힌트) => {
    let h = 0;
    for (let i = 0; i < 40; i++) { window.scrollTo(0, document.body.scrollHeight); await sleep(360); if (document.body.scrollHeight === h) break; h = document.body.scrollHeight; }
    window.scrollTo(0, 0); await sleep(300);

    const T = document.body.innerText || '';
    const 뽑 = (...res) => { for (const re of res) { const m = T.match(re); if (m) return m[1].replace(/[,\s]/g, ''); } return ''; };
    const 캠 = 뽑(/(\d{16}A\d{6})/) || 'campaign';
    const 페이백 = Number(뽑(/([\d,]+)\s*C\b/) || 0);
    const 정원 = Number(뽑(/모집\s*인원\s*:?\s*([\d,]+)/) || 0) || 정원힌트 || 0;

    const 제외어 = ['선택하기', '선택됨', '선정하기', '신청사유', '인플루언서', '당첨자 선정', '전체선택', '지원자'];
    const 이름뽑기 = raw => {
      const 줄 = (raw || '').split('\n').map(s => s.trim()).filter(Boolean);
      for (const re of [/^[가-힣]{2,5}$/, /^@?[A-Za-z0-9._-]{2,20}$/, /^[가-힣A-Za-z0-9._@-]{2,20}$/]) {
        const hit = 줄.find(s => re.test(s) && !제외어.includes(s) && !/^\d+$/.test(s));
        if (hit) return hit;
      }
      return '';
    };
    const 카드정보 = btn => {
      let n = btn, box = null;
      for (let d = 0; d < 10 && n && n.parentElement; d++) { n = n.parentElement; const t = n.innerText || ''; if (이름뽑기(t)) { box = n; if (t.length < 700) break; } }
      const t = box ? box.innerText : '';
      const num = re => { const m = t.match(re); return m ? Number(m[1]) : 0; };
      return { 이름: 이름뽑기(t), 취소: num(/취소\s*(\d+)\s*회/), 선정: num(/선정\s*(\d+)\s*회/), 기타: num(/기타\s*(\d+)\s*회/), 사유: /\[?신청\s*사유\]?/.test(t), 원문: t.replace(/\s+/g, ' ').slice(0, 160), 버튼: btn };
    };

    const 버튼들 = 카드버튼();
    const 기선정 = 클릭요소().filter(e => /^(선택됨|선정됨|당첨됨)$/.test(텍(e))).length;
    const 유효 = 버튼들.map(카드정보).filter(c => c.이름);
    기록('  · ' + 캠 + ' | 페이백 ' + 페이백.toLocaleString() + 'C | 정원 ' + (정원 || '?'));
    기록('  · 지원자 ' + 유효.length + '/' + 버튼들.length + '명 · 이미 선정 ' + 기선정 + '명');
    if (!버튼들.length) { 기록('  ✗ 지원자 버튼 없음'); return null; }

    유효.forEach(c => {
      const s = [];
      if (c.취소 > S.설정.취소상한) s.push('취소 ' + c.취소 + '회');
      if (!S.설정.사유없음허용 && !c.사유) s.push('사유 미작성');
      c.제외사유 = s.join(' / ');
      c.점수 = (c.사유 ? 10 : 0) - c.취소 * 2 - c.기타;
    });
    const 대상자 = 유효.filter(c => !c.제외사유).sort((a, b) => b.점수 - a.점수);
    const 제외자 = 유효.filter(c => c.제외사유);
    const 남은 = 정원 ? Math.max(0, 정원 - 기선정) : 대상자.length;
    const 목표 = S.설정.캠페인당상한 > 0 ? Math.min(S.설정.캠페인당상한, 남은) : 남은;
    기록('  · 선정 예정(최대) ' + Math.min(대상자.length, 목표) + '명 / 사전제외 ' + 제외자.length + '명');
    제외자.forEach(c => 기록('      ✗ ' + c.이름 + ' — ' + c.제외사유));
    if (!실행) return { 캠, 페이백, 정원, 선정: 0, 스킵: 0, 실패: 0, 로그: [], 제외: 제외자.map(c => c.이름 + '(' + c.제외사유 + ')') };

    let 선정 = 0, 스킵 = 0, 실패 = 0, 연속 = 0, 모달덤프 = false; const 로그 = [];
    for (const c of 대상자) {
      if (S.모드 !== 'run') { 기록('  ■ 중지 요청 — 이 캠페인 중단'); break; }
      if (선정 >= 목표) break;
      if (연속 >= 3) { 기록('  ✗ 연속 3회 실패 — 이 캠페인 중단'); break; }
      const 매칭 = 카드버튼().map(카드정보).find(x => x.이름 === c.이름);
      const btn = 매칭 ? 매칭.버튼 : c.버튼;
      if (!btn || !보임(btn)) { 실패++; 연속++; 로그.push([c.이름, '실패', '', '버튼 사라짐']); continue; }
      btn.click(); await sleep(1400);
      const 모달 = await 대기(() => 모달찾기(), 8, 400);
      if (!모달) { 선정++; 연속 = 0; 로그.push([c.이름, '선정', '', '중복이력 없음']); 기록('    ✅ ' + c.이름 + ' (중복이력 없음)'); await sleep(700); continue; }
      // 팝업의 당첨이력 날짜가 로드될 때까지 대기
      let mtxt = 모달.innerText || '';
      await 대기(() => { const m = 모달찾기(); if (m) mtxt = m.innerText || ''; return 경과목록(mtxt).length ? true : null; }, 15, 400);
      const 경과들 = 경과목록(mtxt);
      const 월내 = 경과들.filter(x => x < S.설정.중복창일).length;   // 1개월 이내 기존 당첨 횟수
      const 총이력 = (mtxt.match(/(\d+)\s*건/) || [])[1] || 경과들.length;
      if (!경과들.length) {
        if (!모달덤프) { 모달덤프 = true; 기록('  🔎 [팝업 원문] ' + mtxt.replace(/\s+/g, ' ').slice(0, 300)); }
        const alt = await 대기(() => 다른버튼찾기(), 14); if (alt) alt.click(); else { const x = 포함찾기(/^취소$|^닫기$/); if (x) x.click(); }
        await sleep(1000); 스킵++; 연속 = 0; 로그.push([c.이름, '스킵', '판독불가', '날짜 로드 실패 → 안전 스킵']); 기록('    ⏭ ' + c.이름 + ' — 판독불가(안전 스킵)');
      } else if (월내 < S.설정.월허용횟수) {
        const ok = await 대기(() => 승인버튼찾기(), 14);
        if (ok) { ok.click(); await sleep(1500); 선정++; 연속 = 0; 로그.push([c.이름, '선정(중복승인)', '1개월내 ' + 월내 + '회', '총이력 ' + 총이력 + '건']); 기록('    ✅ ' + c.이름 + ' — 1개월내 ' + 월내 + '회(<' + S.설정.월허용횟수 + ') 승인'); }
        else { 실패++; 연속++; 로그.push([c.이름, '실패', '1개월내 ' + 월내 + '회', '승인 버튼 없음']); const alt = 다른버튼찾기(); if (alt) alt.click(); await sleep(1000); }
      } else {
        const alt = await 대기(() => 다른버튼찾기(), 14); if (alt) alt.click(); await sleep(1000); 스킵++; 연속 = 0;
        로그.push([c.이름, '스킵', '1개월내 ' + 월내 + '회', '1개월 ' + S.설정.월허용횟수 + '회 이상 → 제외']); 기록('    ⏭ ' + c.이름 + ' — 1개월내 ' + 월내 + '회(≥' + S.설정.월허용횟수 + ') 스킵');
      }
      await sleep(700);
    }
    기록('  · 결과: 선정 ' + 선정 + ' / 스킵 ' + 스킵 + ' / 실패 ' + 실패);
    return { 캠, 페이백, 정원, 선정, 스킵, 실패, 로그, 제외: 제외자.map(c => c.이름 + '(' + c.제외사유 + ')') };
  };

  /* ═════════ 진단 · 예행 ═════════ */
  const 한번 = async (실행, 예행) => {
    S.로그 = []; 그리기로그();
    기록('═══ ' + (예행 ? '예행' : '진단') + ' ═══  1개월창 ' + S.설정.중복창일 + '일 · 월 ' + S.설정.월허용횟수 + '회미만 선정 · 취소상한 ' + S.설정.취소상한 + '회');
    if (상세임() && !목록임()) { 기록('[화면] 지원자'); await 지원자처리(false, 0); 끝알림(); return; }
    if (목록임()) {
      const 행 = 행수집(); 기록('[화면] 당첨자 선정 목록 — ' + 행.length + '건');
      행.forEach(r => 기록('   ' + r.코드 + '  ' + r.상태.padEnd(8) + '  ' + (r.등록 + '/' + r.모집 + '/' + r.선정됨)));
      const 할것 = 대상선별(행);
      기록('\n[처리 대상] ' + 할것.length + '건');
      할것.forEach(r => 기록('   → ' + r.코드 + '  ' + r.상태));
      기록('\n🔵 클릭 안 함. 맞으면 「▶ 실행」.'); 끝알림(); return;
    }
    if (관리목록임()) {
      const 행 = 관리행수집(); 기록('[화면] 캠페인 관리 목록 — ' + 행.length + '건');
      행.forEach(r => 기록('   ' + r.코드 + '  ' + r.상태 + '  ' + (r.등록 + '/' + r.모집 + '/' + r.선정됨) + (r.쿠키 ? ' 🍪' : '')));
      기록('\n[선정 대상 쿠키] ' + 행.filter(r => r.쿠키 && 선정필요(r)).length + '건'); 끝알림(); return;
    }
    기록('[화면] ❓ 인식 안 됨. 클릭 가능한 요소:');
    const 빈도 = {}; 클릭요소().forEach(e => { const t = 텍(e) || '(무텍)'; if (t.length <= 40) 빈도[t] = (빈도[t] || 0) + 1; });
    Object.entries(빈도).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([t, n]) => 기록('   ' + String(n).padStart(3) + '개  「' + t + '」'));
    끝알림();
  };
  const 끝알림 = () => 저장('01_선정_' + 오늘().replace(/-/g, '') + '.txt', S.로그.join('\n'));

  /* ═════════ 순회 (실행) ═════════ */
  const 순회 = async () => {
    상태갱신();
    if (S.모드 !== 'run') return;
    const 코드하나 = () => (document.body.innerText.match(/\d{16}A\d{6}/) || [])[0] || '';
    const 다음화면으로 = async () => {
      const 메뉴 = 포함찾기(/^당첨자\s*선정$/) || 포함찾기(/^체험단\s*관리$/);
      if (메뉴) 메뉴.click(); else { history.back(); await sleep(600); history.back(); }
      await 대기(() => ((목록임() || (document.body.innerText.match(/\d{16}A\d{6}/g) || []).length >= 2) ? true : null), 30, 500);
      await sleep(1200);
    };

    // A) 지원자(선택하기) 화면
    if (상세임() && !목록임()) {
      S._대기 = 0;
      기록('\n▶ 지원자 화면 처리');
      const r = await 지원자처리(true, 0);
      if (r) { if (S.완료.indexOf(r.캠) < 0) S.완료.push(r.캠); S.결과.push(r); 쓰기(S); }
      기록('  ← 당첨자 선정 목록으로 복귀');
      await 다음화면으로();
      return 순회();
    }

    // B) 캠페인 상세 — 「당첨자 선정」 클릭
    const 액션 = 선정액션버튼();
    if (액션 && !목록임()) {
      S._대기 = 0;
      const c = 코드하나();
      if (c && S.완료.indexOf(c) >= 0) { 기록('  · ' + c + ' 이미 완료 — 목록으로'); await 다음화면으로(); return 순회(); }
      기록('\n▶ 상세 [' + c + '] — 「당첨자 선정」 클릭');
      액션.click();
      const ok = await 대기(() => (상세임() ? true : null), 30, 500);
      if (!ok) { 기록('  ⏳ 지원자 화면 로딩 대기 — 자동 재시도'); return; }
      await sleep(900); return 순회();
    }

    // C) 당첨자 선정 목록 (선정하기 버튼)
    if (목록임()) {
      S._대기 = 0;
      const 할것 = 대상선별(행수집()).filter(r => S.완료.indexOf(r.코드) < 0);
      if (!할것.length) { 기록('\n■ 모든 캠페인 완료 (' + S.완료.length + '건)'); S.모드 = 'idle'; 쓰기(S); 상태갱신(); 결과저장(); return; }
      const r = 할것[0];
      기록('\n▶ ' + r.코드 + ' (' + r.상태 + ') — 남은 ' + 할것.length + '건');
      const btn = 행수집().find(x => x.코드 === r.코드);
      if (!btn) { 기록('  ✗ 버튼 못 찾음 — 건너뜀'); S.완료.push(r.코드); 쓰기(S); return 순회(); }
      btn.버튼.click();
      const 들어감 = await 대기(() => (상세임() ? true : null), 24, 500);
      if (!들어감) { 기록('  ⏳ 지원자 화면 대기 — 자동 재시도'); return; }
      await sleep(1000); return 순회();
    }

    // D) 캠페인 관리 목록 (수정+삭제 있을 때만) — 과거순 쿠키 상세 진입
    const codes = [...new Set((document.body.innerText.match(/\d{16}A\d{6}/g) || []))];
    if (관리목록임() && codes.length) {
      S._대기 = 0;
      const 행 = 관리행수집().filter(r => r.쿠키 && 선정필요(r) && S.완료.indexOf(r.코드) < 0);
      if (!행.length) {
        기록('\n■ 선정할 쿠키 캠페인이 더 없습니다 (완료 ' + S.완료.length + '건)');
        S.모드 = 'idle'; 쓰기(S); 상태갱신(); 결과저장(); return;
      }
      const r = 행[0];
      기록('\n▶ [' + r.코드 + '] ' + r.상태 + ' · ' + r.등록 + '/' + r.모집 + '/' + r.선정됨 + ' — 남은 ' + 행.length + '건');
      const enter = 진입버튼찾기(r.box);
      if (!enter) { 기록('  ✗ 진입 버튼 못 찾음 — 건너뜀'); S.완료.push(r.코드); 쓰기(S); await sleep(400); return 순회(); }
      기록('  · 상세 진입: 「' + (텍(enter) || enter.tagName) + '」');
      enter.click();
      const 왔나 = await 대기(() => ((선정액션버튼() || 상세임()) ? true : null), 30, 500);
      if (!왔나) { 기록('  ⏳ 상세 진입 대기 — 자동 재시도'); return; }
      await sleep(800); return 순회();
    }

    // E) 알 수 없는/로딩 중 — 끝내지 말고 대기 후 재시도
    S._대기 = (S._대기 || 0) + 1; 쓰기(S);
    if (S._대기 % 4 === 0) {
      const btns = [...new Set(클릭요소().map(텍).filter(t => t && t.length <= 18))].slice(0, 30);
      기록('  ⏳ 화면 로딩/인식 대기 (' + S._대기 + ') — 버튼: [' + btns.join(', ') + ']');
      if (S._대기 >= 20) 기록('  ⚠ 오래 대기 중. 지원자 화면인데 인식 안 되면 위 "선택" 버튼 이름 알려주세요. (멈추려면 「중지」)');
    }
  };

  /* ═════════ 담당자 전달용 목록(캠페인번호 + 현재 선정 수) ═════════ */
  const 담당자목록 = () => {
    let rows = [];
    if (목록임()) rows = 행수집().map(r => ({ 코드: r.코드, 선정: r.선정됨, 모집: r.모집, 등록: r.등록 }));
    else if (관리목록임()) rows = 관리행수집().map(r => ({ 코드: r.코드, 선정: r.선정됨, 모집: r.모집, 등록: r.등록 }));
    if (!rows.length) { 기록('⚠ 「당첨자 선정」 목록 또는 캠페인 관리 목록 화면에서 눌러주세요.'); return; }
    const txt = rows.map(r => r.코드 + '\n' + r.선정 + '명').join('\n\n');
    S.로그 = []; 기록('── 담당자 전달용 (' + rows.length + '건, 현재 선정 수) ──');
    기록(txt);
    기록('── 참고(등록/모집/선정) ──');
    rows.forEach(r => 기록('  ' + r.코드 + '  ' + r.등록 + '/' + r.모집 + '/' + r.선정));
    try { if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => 기록('📋 클립보드에 복사됨 — 담당자에게 붙여넣기 하세요'), () => {}); } catch (e) {}
    저장('담당자_선정인원_' + 오늘().replace(/-/g, '') + '.txt', txt);
  };

  /* ═════════ 결과 저장 ═════════ */
  const 결과저장 = () => {
    const 스탬프 = 오늘().replace(/-/g, '');
    const 요약 = ['■ 체험단 선정 자동화 · ' + 오늘() + (S.시작 ? ' · 시작 ' + S.시작 : ''),
      '  규칙: 1개월(' + S.설정.중복창일 + '일)내 당첨 ' + S.설정.월허용횟수 + '회 미만이면 선정 · 취소 ' + S.설정.취소상한 + '회 초과 제외', ''];
    S.결과.forEach(r => 요약.push('  ' + r.캠 + '  선정 ' + r.선정 + ' / 스킵 ' + r.스킵 + ' / 실패 ' + r.실패 + (r.제외 && r.제외.length ? '\n      사전제외: ' + r.제외.join(', ') : '')));
    const 합 = S.결과.reduce((a, r) => ({ s: a.s + r.선정, k: a.k + r.스킵, f: a.f + r.실패 }), { s: 0, k: 0, f: 0 });
    요약.push('', '  합계  선정 ' + 합.s + ' / 스킵 ' + 합.k + ' / 실패 ' + 합.f);
    저장('01_선정요약_' + 스탬프 + '.txt', 요약.join('\n'));
    const 행들 = ['캠페인\t이름\t결과\t당첨이력\t비고'];
    S.결과.forEach(r => (r.로그 || []).forEach(x => 행들.push(r.캠 + '\t' + x.join('\t'))));
    setTimeout(() => 저장('02_선정로그_' + 스탬프 + '.tsv', 행들.join('\n')), 700);
    setTimeout(() => 저장('03_실행기록_' + 스탬프 + '.txt', S.로그.join('\n')), 1400);
    기록('■ 파일 3개 저장했습니다.');
  };

  /* ═════════ 자동 이어가기 · 부팅 ═════════ */
  const 틱 = async () => {
    if (진행중) return;
    S = 읽기() || S; if (!S.설정.월허용횟수) S.설정 = Object.assign({}, 기본, S.설정);
    if (S.모드 !== 'run') return;
    진행중 = true;
    try { await 순회(); } catch (e) { try { 기록('⚠ 오류: ' + (e && e.message || e)); } catch (_) {} } finally { 진행중 = false; }
  };
  const 부팅 = () => { 패널만들기(); 상태갱신(); if (S.모드 === 'run') { 기록('↻ 이어서 진행합니다…'); setTimeout(틱, 1500); } };
  setInterval(() => {
    if (!패널있음()) 패널만들기();
    상태갱신();
    if (!진행중) { const cur = 읽기(); if (cur && cur.모드 === 'run') 틱(); }
  }, 2000);
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(부팅, 900);
  else window.addEventListener('DOMContentLoaded', () => setTimeout(부팅, 900));
})();
