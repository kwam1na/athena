import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { InputOTPForm } from "./InputOTP";

export function Login() {
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");

  if (step === "signIn") {
    return <LoginForm setStep={setStep} />;
  }
  return <InputOTPForm email={step.email} />;
}
