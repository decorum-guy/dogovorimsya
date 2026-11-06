import { useEffect } from 'react';

export function useDraftGuard(dirty: boolean, blocked: boolean, close: () => void) {
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  return () => {
    if (blocked) return;
    if (!dirty || window.confirm('Есть несохранённый текст или фотографии. Закрыть и потерять изменения?')) close();
  };
}
