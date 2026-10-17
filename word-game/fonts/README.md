# 글꼴 (fonts)

게임이 쓰는 글꼴을 이 폴더에서 바로 내려줘요. 글꼴 서버(Google Fonts 등)에 연결하지 않아서 인터넷 없이도 같은 글꼴로 보여요.

- 출처: npm `@fontsource` 패키지 5.3.0 (`black-han-sans`, `ibm-plex-sans-kr`, `lilita-one`, `noto-sans`)의 `files/*.woff2`
- 남긴 것: Black Han Sans 400, IBM Plex Sans KR 400·500·600·700 (한글 조각 + latin), Lilita One 400 (latin),
  Noto Sans 400·500 (latin, latin-ext, greek: 발음기호 ə ʃ ˈ θ)
- `fonts.css`: 패키지의 CSS에서 위 조각의 `@font-face`만 골라 `files/` 경로로 바꾼 것 (`font-display: swap`, `unicode-range` 그대로)
- 라이선스: 모두 SIL Open Font License 1.1 — `OFL.txt` (글꼴마다 저작권 줄 + 라이선스 본문)
