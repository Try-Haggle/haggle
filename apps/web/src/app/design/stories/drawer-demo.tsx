"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, type DrawerProps } from "@/components/ui/drawer";

export function DrawerDemo({ side, title }: { side: DrawerProps["side"]; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>드로어 열기</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side={side}
        title={title}
        footer={
          <Button fullWidth onClick={() => setOpen(false)}>
            적용
          </Button>
        }
      >
        <p className="text-ink-secondary text-sm">
          필터·설정 같은 보조 패널을 담는 영역입니다. Escape나 바깥 클릭으로 닫힙니다.
        </p>
      </Drawer>
    </>
  );
}
