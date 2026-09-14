# maison-userscripts

메종원스이어 · 스타일씨(stylec.co.kr) 체험단 업무 자동화 유저스크립트 모음.
Tampermonkey에서 아래 설치 주소로 설치하면, 이후 파일이 갱신될 때마다 **자동 업데이트**됩니다.

## 스크립트

| 파일 | 용도 | 버전 | 설치(자동갱신) 주소 |
|------|------|------|----------------------|
| `geomsu.user.js` | 체험단 검수 자동화 (승인/반려/페이백조정 + 주문번호 돌려쓰기 탐지) | v39 | https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/geomsu.user.js |
| `seonjeong.user.js` | 당첨자 선정 자동화 (중복팝업 판정 + 담당자용 내보내기) | v2.2 | https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/seonjeong.user.js |
| `qa.user.js` | 1:1 문의 자동응답 (유형 분류 후 정본 답변) | v1.1 | https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/qa.user.js |

## 설치 방법 (PC마다 1회)

1. 크롬에 **Tampermonkey** 확장 설치
2. 위 표의 "설치 주소"를 클릭 → Tampermonkey 설치 화면이 뜨면 **설치**
3. 스타일씨 사이트에 들어가면 우측/화면에 자동화 패널이 뜸

## 자동 업데이트 구조

각 스크립트 헤더에 `@updateURL` / `@downloadURL`이 이 저장소의 raw 주소로 박혀 있음.
파일을 수정해서 이 저장소에 push 하고 `@version` 숫자만 올리면, 설치된 모든 PC가 Tampermonkey를 통해 자동으로 최신본을 받아감.

## 수정하는 법

1. 클로드에게 수정 요청 → 수정된 파일 받기 (또는 클로드 코드로 직접 수정)
2. `@version` 숫자를 올림 (예: 39.0 → 39.1)
3. 이 저장소에 push
4. 설치된 PC들이 자동 갱신 (수동으로 당기려면 Tampermonkey → 대시보드 → 업데이트 확인)
