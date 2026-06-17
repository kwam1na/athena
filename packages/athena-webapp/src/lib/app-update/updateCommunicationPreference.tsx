import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_UPDATE_COMMUNICATION_VARIANT,
  UpdateCommunicationPreferenceContext,
  type UpdateCommunicationPreferenceContextValue,
  type UpdateCommunicationVariant,
} from "./updateCommunicationPreferenceContext";

export function UpdateCommunicationPreferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<
    Map<string, UpdateCommunicationVariant>
  >(() => new Map());

  const registerPreference = useCallback(
    ({
      surfaceId,
      variant,
    }: Parameters<
      UpdateCommunicationPreferenceContextValue["registerPreference"]
    >[0]) => {
      setPreferences((current) => {
        if (current.get(surfaceId) === variant) {
          return current;
        }

        const next = new Map(current);
        next.set(surfaceId, variant);
        return next;
      });

      return () => {
        setPreferences((current) => {
          if (!current.has(surfaceId)) {
            return current;
          }

          const next = new Map(current);
          next.delete(surfaceId);
          return next;
        });
      };
    },
    [],
  );

  const variant = useMemo(
    () => getPreferredVariant(preferences),
    [preferences],
  );
  const value = useMemo<UpdateCommunicationPreferenceContextValue>(
    () => ({
      variant,
      registerPreference,
    }),
    [registerPreference, variant],
  );

  return (
    <UpdateCommunicationPreferenceContext.Provider value={value}>
      {children}
    </UpdateCommunicationPreferenceContext.Provider>
  );
}

function getPreferredVariant(
  preferences: Map<string, UpdateCommunicationVariant>,
) {
  let preferred = DEFAULT_UPDATE_COMMUNICATION_VARIANT;

  for (const variant of preferences.values()) {
    preferred = variant;
  }

  return preferred;
}
