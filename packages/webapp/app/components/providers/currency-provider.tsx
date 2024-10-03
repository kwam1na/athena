import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useMemo,
} from "react";

type CurrencyContextType = {
  loading: boolean;
  storeCurrency: string;
  setStoreCurrency: React.Dispatch<React.SetStateAction<string>>;
};

const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const useStoreCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
};

export const CurrencyProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [storeCurrency, setStoreCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const contextValue = useMemo(
    () => ({ loading, storeCurrency, setStoreCurrency }),
    [storeCurrency]
  );

  useEffect(() => {
    fetchStoreCurrency();
  }, []);

  const fetchStoreCurrency = async () => {
    try {
      // const res = await axios.get(`/api/v1/stores/1`);
      // const { currency } = res?.data || {};
      // setStoreCurrency(currency);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CurrencyContext.Provider value={contextValue}>
      {children}
    </CurrencyContext.Provider>
  );
};
