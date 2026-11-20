import { useRef, type FormEvent } from "react";

/**
 * Korean/Japanese/Chinese IMEs: pressing Enter while a syllable is still being
 * composed can submit the form *before* the syllable is committed, leaving a stray
 * character behind. Submits that happen mid-composition are deferred until the
 * composition ends. Spread the returned props onto the <form>.
 */
export function useImeSafeSubmit(onSubmit: () => void) {
  const composing = useRef(false);
  const pending = useRef(false);
  return {
    onSubmit(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      if (composing.current) pending.current = true;
      else onSubmit();
    },
    onCompositionStart() {
      composing.current = true;
    },
    onCompositionEnd() {
      composing.current = false;
      if (pending.current) {
        pending.current = false;
        // The committed text lands in the input right after compositionend.
        setTimeout(onSubmit, 0);
      }
    },
  };
}
