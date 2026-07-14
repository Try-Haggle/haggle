# Haggle UI — 컴포넌트 컨벤션

> Haggle 디자인 시스템 프리미티브. 모든 컴포넌트는 **CVA variant + `cn()` 병합** 패턴을 따른다.
> 라이브 카탈로그: `pnpm dev` → [localhost:3000/design](http://localhost:3000/design) (로컬·staging만, prod 숨김)

---

## 철학 — "정해진 variant로 90%, `className`으로 10%"

컴포넌트는 **디자인 결정을 강제**하되, **레이아웃은 열어둔다.**

| 양극단 | 결과 |
|--------|------|
| 완전 고정 (variant만, 그 외 차단) | 조금만 달라도 못 씀 → 복붙/포크 → 드리프트 |
| 완전 커스터마이즈 (색·패딩·radius 다 props) | 시스템 강제 불가 → 인라인 스타일 카오스 |

→ 둘 다 일관성 붕괴로 끝난다. 우리는 **중간(constrained + escape hatch)** 을 택한다.

---

## 무엇을 잠그고 무엇을 여는가

| 종류 | 처리 | 이유 |
|------|------|------|
| 색 / 톤 / 강조 (`primary`, `gold`, `success`…) | **variant 전용** (임의 색 props ❌) | 팔레트·의미 보호 — 시스템의 본질 |
| 크기 (`sm`·`md`·`lg`) | **variant** | 스케일 일관성 |
| 레이아웃 / 여백 / 너비 (`w-full`, `flex-1`, `mt-4`) | **`className`** | 일회성 배치는 variant로 만들 가치 없음 |
| 동작 / 네이티브 (`onClick`, `disabled`, `type`, `aria-*`) | **`...props` 통과** | 당연히 열려야 함 |
| 반복되는 새 시각 패턴 | **variant로 승격** | 3번 이상 반복되면 그때 CVA에 추가 |

---

## ⚠️ 거버넌스 규칙

`cn()`(tailwind-merge)은 `className`이 variant 클래스를 **덮을 수 있게** 한다 — 탈출구의 양날.

> **`className`으로 토큰 색을 덮지 말 것.**
> 새 색·강조가 필요하면 → **variant를 추가**한다 (CVA 객체에 키 하나 + `/design`에서 확인).
> `className`은 **레이아웃·여백 전용.**

이러면 "필요하면 열 수 있되, 여는 방식이 시스템 안으로 들어온다."

---

## 컴포넌트 작성 패턴

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const fooVariants = cva("기본 클래스", {
  variants: { tone: { default: "...", accent: "..." } },
  defaultVariants: { tone: "default" },
});

export type FooProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof fooVariants>;

export function Foo({ className, tone, ...props }: FooProps) {
  return <div className={cn(fooVariants({ tone }), className)} {...props} />;
}
```

- 색은 **시맨틱 토큰 유틸**만 사용: `bg-surface`, `text-ink`, `border-line`, `bg-action-primary`,
  `text-success` 등 (토큰 정의: [`globals.css`](../../app/globals.css)). 원시 색(`slate-*`, `text-white`)·hex 직접 사용 ❌
- 타이포는 **role 유틸**로: `text-display` · `text-h1` · `text-h2` · `text-h3` · `text-body` ·
  `text-body-sm` · `text-label` · `text-data` (패밀리+크기+행간+자간 묶음). 임의 `text-4xl`·`text-[15px]` ❌
- variants 함수도 export → `<Link className={buttonVariants({ variant })}>` 처럼 재사용

---

## 새 컴포넌트를 카탈로그에 추가

1. `components/ui/<name>.tsx` 작성 (위 패턴)
2. `app/design/stories/<name>.tsx`에 `Story` 작성 (control 스키마 + render)
3. `app/design/stories/registry.ts`의 `stories` 배열에 등록

→ 사이드바·라우트·인터랙티브 플레이그라운드가 자동 생성된다.
