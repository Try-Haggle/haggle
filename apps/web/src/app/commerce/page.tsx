import { CommerceDashboard } from "./commerce-dashboard";

export const metadata = {
  title: "Haggle — 커머스 대시보드",
  description: "협상 후 거래 흐름: 승인, 결제, 배송, 분쟁 해결",
};

export default function CommercePage() {
  return <CommerceDashboard />;
}
