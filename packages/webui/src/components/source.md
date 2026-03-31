# source.md

## 역할

- `components`는 여러 화면에서 공통으로 쓰이는 재사용 UI를 담습니다.

## 중요 하위 영역

- `runs`: 실행 카드, 요약, 승인, 타임라인, 대상 배지
- `setup`: 설정용 폼과 런타임 패널
- `chat`: 채팅 전용 보조 패널
- `Layout`, `ApprovalModal`, `MessageBubble`, `UpdatePanel` 같은 상위 공용 컴포넌트

## 메모

- 이 폴더에는 범용 UI와 도메인 특화 모니터링 위젯이 함께 있습니다.
- 제품 고유의 표시 로직은 주로 `runs`와 `setup`에 몰려 있습니다.
