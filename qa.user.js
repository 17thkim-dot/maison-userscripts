// ==UserScript==
// @name         1:1 문의 자동응답 (메종원스이어)
// @namespace    maison-once-a-year
// @version      1.1
// @description  스타일씨 1:1 문의 — 유형 자동분류 후 정본 답변 자동 입력/발송. 특이사항만 보고. v1.1: 답변칸 인식 확대(textarea·input·contenteditable), 진단 강화, 단축키 Alt+1/2/3.
// @match        https://stylec.co.kr/*
// @match        https://*.stylec.co.kr/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/qa.user.js
// @downloadURL  https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/qa.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ═════════ 쿠폰 정책 전환 (strict = 정가 유지 / lenient = 할인가 인정) ═════════ */
  const COUPON_POLICY = 'strict';   // 대표 확정: 장바구니 담고 쿠폰 해제 후 정가 결제

  /* ═════════ 답변 정본 (56번 문서 · 200자 이내) ═════════ */
  const 답변 = {
    쿠폰_strict: '안녕하세요. 로켓와우 회원께는 쿠폰이 자동 적용됩니다. 장바구니에 담으신 뒤 쿠폰 적용을 해제하시고 28,000원으로 결제해 주세요. 결제금액이 28,000원이 아니면 환급 조건에 맞지 않으니 꼭 확인 부탁드립니다. 감사합니다.',
    쿠폰_lenient: '안녕하세요. 로켓와우 회원께는 쿠폰이 자동 적용됩니다. 장바구니에 담아 쿠폰 적용을 해제하고 28,000원으로 결제해 주시면 가장 좋습니다. 해제가 어려우시면 26,040원 그대로 결제하셔도 환급에 불이익은 없습니다. 감사합니다.',
    취소: '안녕하세요. 취소요청 내역 확인했습니다. 두 건 중 한 건만 취소 처리하고 나머지 한 건은 그대로 진행해 드리겠습니다. 진행되는 캠페인으로 구매와 상품평 남겨주시면 됩니다. 감사합니다.',
    리뷰: '안녕하세요. 수령 후 48시간 이내에 사진 1장 이상, 텍스트 2줄 이상으로 상품평을 남겨주세요. 본문 맨 첫 줄에 「메종원스이어로부터 구매대금 일부를 환급받고 작성한 후기입니다.」를 텍스트로 입력해 주셔야 합니다. 이미지 안 문구는 인정되지 않습니다. 감사합니다.',
    배송: '안녕하세요. 쿠팡 로켓배송으로 발송되어 보통 하루 안에 도착합니다. 명절 연휴에는 하루 정도 늦어질 수 있습니다. 수령하신 날로부터 48시간 이내에 상품평 부탁드립니다. 감사합니다.',
    기간: '안녕하세요. 구매는 캠페인 상세에 안내된 구매 마감일까지 완료해 주셔야 합니다. 마감일이 지난 구매는 환급 대상에서 제외되니 기간 내에 진행 부탁드립니다. 감사합니다.'
  };

  // 분류 규칙 (우선순위: 취소 → 쿠폰 → 리뷰 → 배송 → 기간)
  const 분류하기 = q => {
    if (/취소/.test(q)) return '취소';
    if (/쿠폰|할인|자동\s*적용|할인가|정가|\d{2,3},?\d{3}\s*원|결제.*원|로켓와우/.test(q)) return '쿠폰';
    if (/리뷰|후기|상품평|사진|텍스트|별점|작성\s*방법|어떻게\s*(써|작성|남기)/.test(q)) return '리뷰';
    if (/배송|도착|언제.*(와|받|오나요)|출고|택배/.test(q)) return '배송';
    if (/기간|마감|언제까지|며칠까지|구매.*까지|기한/.test(q)) return '기간';
    return null;   // 특이사항
  };
  const 답변고르기 = 유형 => 유형 === '쿠폰' ? (COUPON_POLICY === 'lenient' ? 답변.쿠폰_lenient : 답변.쿠폰_strict) : 답변[유형];

  /* ═════════ 상태 ═════════ */
  const KEY = 'mo_qa_상태';
  const 패널ID = 'mo-qa-패널';
  const 읽기 = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const 쓰기 = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const 초기상태 = () => ({ 로그: [] });
  let S = 읽기() || 초기상태();

  /* ═════════ 유틸 ═════════ */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const 패널있음 = () => document.getElementById(패널ID);
  const 보임 = e => e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 && !(패널있음() && 패널있음().contains(e));
  const 텍 = e => (e && (e.innerText || e.textContent) || '').replace(/\s+/g, ' ').trim();
  const 오늘 = () => new Date().toISOString().slice(0, 10);
  const setVal = (el, v) => {
    if (el.isContentEditable) {
      el.focus(); el.textContent = v;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus(); setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const 저장 = (이름, 내용) => {
    try { const b = new Blob(['﻿' + 내용], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 이름; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch (e) {}
  };

  /* ═════════ 문의 블록 수집 ═════════ */
  // 각 문의 = 답변 textarea + 「답변하기」 버튼을 가진 행. 질문글은 그 행 안의 텍스트에서 UI를 뺀 것.
  const 답변칸목록 = () => [...document.querySelectorAll('textarea, input[type=text], [contenteditable=""], [contenteditable=true]')].filter(보임);
  const 문의수집 = () => {
    const out = [];
    답변칸목록().forEach(ta => {
      if (!보임(ta)) return;
      // 이 textarea가 속한 '행' 박스: 위로 올라가며 「답변하기」 버튼을 포함하는 가장 가까운 박스
      let box = ta, 답변버튼 = null;
      for (let d = 0; d < 8 && box && box.parentElement; d++) {
        box = box.parentElement;
        const b = [...box.querySelectorAll('button,a,[role=button]')].filter(보임).find(x => /^답변하기$/.test(텍(x)));
        if (b) { 답변버튼 = b; break; }
      }
      if (!답변버튼) return;
      // 질문글 추출: 행 텍스트에서 placeholder/버튼/안내문 제거
      const raw = box.innerText || '';
      const ph = ta.getAttribute('placeholder') || ta.getAttribute('data-placeholder') || ta.getAttribute('aria-label') || '';
      let 질문 = raw;
      [ph, '답변하기', '관련 체험단', '문의시각', '질문자', '문의글'].forEach(x => { if (x) 질문 = 질문.split(x).join(' '); });
      질문 = 질문.replace(/\d{16}A\d{6}/g, ' ').replace(/\d{2}\.\s?\d{2}\.\s?\d{2}/g, ' ').replace(/최대\s*200자/g, ' ').replace(/\s+/g, ' ').trim();
      // 질문자 이름 추정: placeholder "...님에게 전달" 앞의 이름
      const 이름 = (ph.match(/([가-힣A-Za-z0-9._]{2,20})\s*님에게/) || [])[1] || (질문.match(/[가-힣]{2,4}/) || [''])[0];
      out.push({ 이름, 질문, ta, 버튼: 답변버튼, box });
    });
    return out;
  };

  /* ═════════ 로그 ═════════ */
  let 본문;
  const 그리기 = () => { if (본문) { 본문.textContent = S.로그.join('\n'); 본문.scrollTop = 본문.scrollHeight; } };
  const 기록 = s => { S.로그.push(s); if (S.로그.length > 400) S.로그.shift(); 쓰기(S); 그리기(); try { console.log(s); } catch (e) {} };

  /* ═════════ 진단 ═════════ */
  const 진단 = () => {
    S.로그 = []; 그리기(); 기록('═══ 진단 (분류만, 입력·발송 안 함) ═══');
    const nTa = document.querySelectorAll('textarea').length;
    const nIn = document.querySelectorAll('input[type=text]').length;
    const nCe = document.querySelectorAll('[contenteditable=""],[contenteditable=true]').length;
    const nBtn = [...document.querySelectorAll('button,a,[role=button]')].filter(x => /^답변하기$/.test(텍(x))).length;
    기록('화면 요소 — textarea:' + nTa + ' / input:' + nIn + ' / contenteditable:' + nCe + ' / 「답변하기」버튼:' + nBtn);
    const ms = 문의수집();
    기록('매칭된 문의(답변칸+버튼): ' + ms.length + '건\n');
    if (!ms.length) {
      기록('⚠ 답변칸을 못 잡았습니다. 아래 샘플로 형식을 확인하겠습니다:');
      답변칸목록().slice(0, 6).forEach((t, i) => 기록('   답변칸' + i + ' [' + t.tagName + (t.isContentEditable ? '/editable' : '') + '] ph="' + (t.getAttribute('placeholder') || t.getAttribute('data-placeholder') || '') + '"'));
      [...document.querySelectorAll('button,a,[role=button]')].filter(보임).map(텍).filter(t => t && t.length <= 12).slice(0, 20).forEach((t, i) => { if (i === 0) 기록('   버튼 샘플:'); 기록('     「' + t + '」'); });
      return;
    }
    ms.forEach(m => { const t = 분류하기(m.질문); 기록((t ? '✅ [' + t + ']' : '🔴 [특이]') + ' ' + (m.이름 || '?') + ' : ' + (m.질문 || '(질문 못읽음)').slice(0, 70)); });
  };

  /* ═════════ 처리 ═════════ */
  let 진행중 = false;
  const 처리 = async (발송) => {
    if (진행중) return; 진행중 = true;
    try {
      S.로그 = []; 그리기();
      기록('═══ ' + (발송 ? '실행(채우기+발송)' : '예행(채우기만)') + ' ═══  쿠폰정책=' + COUPON_POLICY);
      const 문의들 = 문의수집();
      기록('발견한 미답변 문의: ' + 문의들.length + '건\n');
      if (!문의들.length) { 기록('⚠ 답변 입력칸(textarea)이 있는 문의를 못 찾았습니다. 1:1 문의 페이지에서 실행하세요.'); return; }

      const 유형카운트 = {}; const 특이 = []; const 조치필요 = []; let 자동 = 0;
      for (const m of 문의들) {
        const 유형 = 분류하기(m.질문);
        if (!유형) {
          특이.push(m);
          기록('🔴 특이사항 [' + (m.이름 || '?') + '] ' + m.질문.slice(0, 60));
          continue;
        }
        const 답 = 답변고르기(유형);
        setVal(m.ta, 답);
        유형카운트[유형] = (유형카운트[유형] || 0) + 1; 자동++;
        기록('✅ [' + 유형 + '] ' + (m.이름 || '?') + ' — 답변 ' + (발송 ? '입력+발송' : '입력'));
        if (유형 === '취소') 조치필요.push(m.이름 + ' (취소요청 — 유지/거절은 대표님이 직접 처리)');
        if (발송) {
          await sleep(500);
          m.버튼.click();
          await sleep(1400);
        } else {
          await sleep(200);
        }
      }

      기록('\n── 요약 ──');
      기록('자동답변: ' + 자동 + '건  ' + JSON.stringify(유형카운트));
      기록('특이사항(수동 확인 필요): ' + 특이.length + '건');
      특이.forEach(m => 기록('   • ' + (m.이름 || '?') + ' : ' + m.질문.slice(0, 80)));
      if (조치필요.length) { 기록('\n⚠ 대표 조치 필요 (취소 처리):'); 조치필요.forEach(x => 기록('   • ' + x)); }
      if (발송) 기록('\n※ 발송 완료. 특이사항' + 특이.length + '건만 직접 답변해 주세요.');
      else 기록('\n※ 예행 — 발송 안 함. 칸에 채워진 답변 확인 후 문제없으면 「실행」으로 발송하세요.');

      // 특이사항 리포트 저장
      const rep = ['■ 1:1 문의 자동응답 · ' + 오늘() + ' · ' + (발송 ? '발송' : '예행'),
        '자동답변 ' + 자동 + '건 ' + JSON.stringify(유형카운트), '',
        '── 특이사항(수동 확인) ' + 특이.length + '건 ──',
        ...특이.map(m => (m.이름 || '?') + '\t' + m.질문),
        '', '── 대표 조치 필요(취소) ' + 조치필요.length + '건 ──', ...조치필요];
      저장('qa_리포트_' + 오늘().replace(/-/g, '') + '.txt', rep.join('\n'));
    } catch (e) { 기록('⚠ 오류: ' + (e && e.message || e)); }
    finally { 진행중 = false; }
  };

  /* ═════════ 패널 ═════════ */
  const 버튼CSS = (bg, fg) => 'font:inherit;font-size:11.5px;cursor:pointer;background:' + bg + ';color:' + fg + ';border:0;border-radius:3px;padding:6px 12px';
  const 패널만들기 = () => {
    if (패널있음()) return;
    const p = document.createElement('div');
    p.id = 패널ID;
    p.style.cssText = 'position:fixed;left:14px;bottom:14px;width:min(460px,46vw);z-index:2147483647;background:#0f1518;color:#e2ebef;border:1px solid #2e3d44;border-radius:8px;font:12px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 14px 46px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden';
    p.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;padding:9px 11px;background:#16232a;border-bottom:1px solid #2e3d44;cursor:move">' +
        '<b style="flex:1;color:#7fd0e8">1:1 문의 자동응답</b>' +
        '<span id="mo-qa-st" style="font-size:11px;color:#8fa7b0">' + COUPON_POLICY + '</span>' +
        '<button data-a="min" style="' + 버튼CSS('#294049', '#cbd6da') + '">▾</button>' +
      '</div>' +
      '<div data-a="wrap" style="display:flex;flex-direction:column">' +
        '<div style="display:flex;gap:6px;padding:9px 11px;flex-wrap:wrap;border-bottom:1px solid #20303600">' +
          '<button data-a="diag" style="' + 버튼CSS('#294049', '#dfeaee') + '">진단</button>' +
          '<button data-a="dry" style="' + 버튼CSS('#294049', '#dfeaee') + '">예행(채우기)</button>' +
          '<button data-a="run" style="' + 버튼CSS('#1f6f5f', '#fff') + '">▶ 실행(발송)</button>' +
          '<span style="flex:1"></span>' +
          '<button data-a="save" style="' + 버튼CSS('#294049', '#dfeaee') + '">리포트</button>' +
        '</div>' +
        '<pre data-a="body" style="margin:0;padding:10px 12px;height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all"></pre>' +
      '</div>';
    document.body.appendChild(p);
    본문 = p.querySelector('[data-a=body]'); 그리기();
    const $ = a => p.querySelector('[data-a=' + a + ']');
    const 헤더 = p.firstElementChild;
    헤더.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return; e.preventDefault();
      const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      p.style.right = 'auto'; p.style.bottom = 'auto';
      const mv = ev => { p.style.left = Math.max(0, Math.min(ev.clientX - dx, innerWidth - r.width)) + 'px'; p.style.top = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    $('min').onclick = () => { const w = $('wrap'); w.style.display = w.style.display === 'none' ? 'flex' : 'none'; };
    $('diag').onclick = () => 진단();
    $('dry').onclick = () => 처리(false);
    // 실행 = 두번 클릭 확인
    let armed = false, t = null;
    $('run').onclick = () => {
      const b = $('run');
      if (!armed) { armed = true; b.textContent = '한번 더 ▶ 발송'; b.style.background = '#8b3a32'; 기록('⚠ 분류된 문의에 실제로 답변이 발송됩니다(알림톡). 4초 안에 한번 더.'); t = setTimeout(() => { armed = false; b.textContent = '▶ 실행(발송)'; b.style.background = '#1f6f5f'; }, 4000); return; }
      clearTimeout(t); armed = false; b.textContent = '▶ 실행(발송)'; b.style.background = '#1f6f5f'; 처리(true);
    };
    $('save').onclick = () => 저장('qa_로그_' + 오늘().replace(/-/g, '') + '.txt', S.로그.join('\n'));
  };

  // 버튼이 안 눌릴 때 대비 — 단축키 (Alt+1 진단 / Alt+2 예행 / Alt+3 실행)
  window.addEventListener('keydown', e => {
    if (!e.altKey) return;
    if (e.key === '1') { e.preventDefault(); 진단(); }
    else if (e.key === '2') { e.preventDefault(); 처리(false); }
    else if (e.key === '3') { e.preventDefault(); 처리(true); }
  });

  setInterval(() => { if (!패널있음()) 패널만들기(); }, 2000);
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(패널만들기, 900);
  else window.addEventListener('DOMContentLoaded', () => setTimeout(패널만들기, 900));
})();
