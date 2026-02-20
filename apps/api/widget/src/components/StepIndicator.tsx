import React from "react";

interface Step {
  label: string;
}

interface StepIndicatorProps {
  currentStep: number;
  steps: Step[];
}

export default function StepIndicator({
  currentStep,
  steps,
}: StepIndicatorProps) {
  return (
    <div className="step-indicator">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isComplete = stepNumber < currentStep;

        return (
          <React.Fragment key={step.label}>
            {index > 0 && (
              <div
                className={`step-indicator__line ${
                  isComplete || isActive ? "step-indicator__line--filled" : ""
                }`}
              />
            )}
            <div className="step-indicator__item">
              <div
                className={`step-indicator__circle ${
                  isActive
                    ? "step-indicator__circle--active"
                    : isComplete
                      ? "step-indicator__circle--complete"
                      : ""
                }`}
              >
                {isComplete ? "✓" : stepNumber}
              </div>
              <span
                className={`step-indicator__label ${
                  isActive ? "step-indicator__label--active" : ""
                }`}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
