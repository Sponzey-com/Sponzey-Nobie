# 메모리 정책

이 파일은 메모리 사용과 기록 기준만 다룬다. 이름과 말투는 `identity.md`, 사용자 정보는 `user.md`, 장기 실행 원칙은 `soul.md`를 따른다.

---

## 범위

- short-term memory: 현재 run 안에서만 필요한 임시 작업 맥락이다.
- session memory: 같은 대화 세션에서 이어지는 요약과 열린 작업 맥락이다.
- task memory: 같은 lineage 또는 명시 handoff 안에서만 쓰는 실행 맥락이다.
- artifact memory: 파일, 이미지, 캡처, 전달 대상, delivery receipt 같은 산출물 metadata다.
- diagnostic memory: 오류, 성능, 복구, 내부 진단 기록이다.
- long-term memory: 세션을 넘어 유지해도 되는 확인된 사용자/프로젝트 사실이다.

---

## 사용 규칙

- 현재 요청에 필요한 memory scope만 주입한다.
- 진단 요청이 아니면 diagnostic memory를 일반 응답에 기본 주입하지 않는다.
- 사용자가 직접 말했거나 신뢰 가능한 설정으로 확인된 사실만 long-term memory로 저장한다.
- 경로명, 계정명, 채널 표시명만 보고 사용자 이름이나 선호를 추정하지 않는다.
- 산출물 자체, 산출물 경로, 전달 receipt는 artifact memory로 다룬다.
- task lineage가 다른 memory를 자동으로 섞지 않는다.

---

## 검색과 벡터 저하 처리

- 기본 검색은 FTS를 우선하고, vector 검색은 선택적 보강 경로로만 사용한다.
- embedding provider가 없거나 timeout, model mismatch, dimension mismatch, stale embedding 상태면 FTS-only로 낮춰 진행한다.
- vector 저하 상태는 diagnostic memory에 남기되 일반 응답에 raw 오류로 노출하지 않는다.
- embedding model이나 dimension이 바뀐 기존 vector는 새 vector와 섞어 scoring하지 않는다.
- SQLite vector extension 도입은 운영 안정화 경로에 직접 섞지 않고 별도 실험 항목으로 분리한다.

---

## Re-Embedding / Archive / Compaction

- re-embedding은 요청 path를 막지 않는 별도 작업으로 처리한다.
- re-embedding 대상은 stale checksum, model 변경, dimension 변경, failed index job 순으로 정리한다.
- 오래된 task memory는 lineage 완료 후 요약을 남기고 archive 대상으로 전환한다.
- artifact memory는 delivery receipt와 재다운로드 경로를 보존해야 하며, 원본 파일 정리는 별도 보존 정책을 따른다.
- diagnostic memory는 일반 memory와 섞지 않고, 장애 분석과 운영 지표 용도로만 보존 또는 압축한다.
- compaction은 pending approval, pending delivery, 마지막 usable snapshot을 보존한 뒤 수행한다.

---

## 금지

- secret, token, API key, OAuth credential을 prompt source나 memory에 평문 저장하지 않는다.
- 실패 로그를 사용자-facing 응답에 그대로 노출하기 위해 memory에서 꺼내지 않는다.
- 오래된 memory가 최신 사용자 지시와 충돌하면 최신 지시를 우선한다.
