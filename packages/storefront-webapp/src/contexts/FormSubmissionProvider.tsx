import React, { createContext, useContext, useRef } from "react";

// Define the context type
type FormSubmissionContextType = {
  registerHandler: (handler: (p: any) => void | Promise<void>) => void;
  runHandlers: () => Promise<void>;
};

// Create the context with a proper type
const FormSubmissionContext = createContext<FormSubmissionContextType | null>(
  null
);

// Custom hook to use the context
export const useFormSubmission = () => {
  const context = useContext(FormSubmissionContext);
  if (!context) {
    throw new Error(
      "useFormSubmission must be used within a FormSubmissionProvider"
    );
  }
  return context;
};

// Provider component
export const FormSubmissionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const submissionHandlers = useRef<((params?: any) => void | Promise<void>)[]>(
    []
  );

  // Function to register a new handler
  const registerHandler = (handler: (params: any) => void | Promise<void>) => {
    submissionHandlers.current.push(handler);
  };

  // Function to execute all handlers
  const runHandlers = async () => {
    for (const handler of submissionHandlers.current) {
      await handler(); // Await each handler in sequence
    }
  };

  return (
    <FormSubmissionContext.Provider value={{ registerHandler, runHandlers }}>
      {children}
    </FormSubmissionContext.Provider>
  );
};
