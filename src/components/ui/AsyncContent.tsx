import type { ReactNode } from "react";

import type { AsyncState } from "../../lib/useAsync";
import { ErrorState } from "./ErrorState";
import { Loading } from "./States";

interface AsyncContentProps<T> {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
  skeleton?: ReactNode;
}

/** Renders loading / error / content for a `useAsync` result. */
export function AsyncContent<T>({
  state,
  children,
  loadingLabel,
  skeleton,
}: AsyncContentProps<T>) {
  if (state.loading) {
    return <>{skeleton ?? <Loading label={loadingLabel} />}</>;
  }
  if (state.error) {
    return <ErrorState message={state.error} onRetry={state.reload} />;
  }
  if (state.data === null) {
    return null;
  }
  return <>{children(state.data)}</>;
}
