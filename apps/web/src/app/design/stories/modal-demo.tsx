"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal, type ModalProps } from "@/components/ui/modal";

export function ModalDemo({
  size,
  title,
  withFooter,
}: {
  size: ModalProps["size"];
  title: string;
  withFooter: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>모달 열기</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        size={size}
        footer={
          withFooter ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                확인
              </Button>
            </>
          ) : undefined
        }
      >
        <p className="text-ink-secondary text-sm">
          협상을 시작하면 에이전트가 자동으로 가격을 조율합니다. 계속하시겠어요?
        </p>
      </Modal>
    </>
  );
}
