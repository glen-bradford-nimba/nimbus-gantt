/**
 * ContentArea.tsx (minimal) — empty host div; engine mounts imperatively.
 */
import type { SlotProps } from '../../types';

export function ContentArea(_props: SlotProps) {
  return (
    <div className="nga-content-outer" data-slot="ContentArea">
      <div className="nga-content" data-nga-gantt-host="1" />
    </div>
  );
}
