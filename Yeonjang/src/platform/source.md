# source.md

## 역할

- `platform`은 OS별 자동화 backend를 제공합니다.

## 주요 파일

- `macos.rs`: 현재 가장 많이 구현된 경로
- `windows.rs`, `linux.rs`: 골격 또는 부분 구현
- `shared.rs`: OS backend 사이에서 공통으로 쓰는 보조 함수
- `mod.rs`: backend 선택

## 메모

- capability 사용 가능 여부는 OS 지원 여부와 현재 권한 설정에 함께 의존합니다.
- 새 장치/시스템 기능은 추상화 정의 뒤에 보통 이 폴더 구현이 따라와야 합니다.
