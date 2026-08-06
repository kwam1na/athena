import { useState } from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ReportQuiz } from "@/lib/docs/reportContract";
import { cn } from "@/lib/utils";

/**
 * Interactive grading UI for a report's quiz data. Contract-v2 reports carry
 * the quiz as inert markup; this component owns selection, grading against
 * the pass threshold, explanations, and reset.
 */
export function DocsReportQuiz({ quiz }: { quiz: ReportQuiz }) {
  const [selections, setSelections] = useState<Record<number, number>>({});
  const [isGraded, setIsGraded] = useState(false);

  const answeredCount = Object.keys(selections).length;
  const score = quiz.questions.reduce(
    (total, question, index) =>
      total + (selections[index] === question.correctIndex ? 1 : 0),
    0,
  );
  const passed = score >= quiz.passThreshold;

  const reset = () => {
    setSelections({});
    setIsGraded(false);
  };

  return (
    <section className="report-quiz" aria-label="Comprehension quiz">
      <h2>Comprehension quiz</h2>
      <p className="report-quiz__intro">
        Pass required: {quiz.passThreshold} of {quiz.questions.length}.
      </p>

      <ol className="report-quiz__questions">
        {quiz.questions.map((question, questionIndex) => {
          const selected = selections[questionIndex];
          const isCorrect = selected === question.correctIndex;
          return (
            <li key={questionIndex} className="report-quiz__question">
              <fieldset disabled={isGraded}>
                <legend
                  // Quiz content is sensor-checked, sanitized report markup
                  // (code/em/strong spans), not user input.
                  dangerouslySetInnerHTML={{ __html: question.promptHtml }}
                />
                <div className="report-quiz__options" role="radiogroup">
                  {question.optionsHtml.map((optionHtml, optionIndex) => {
                    const isSelected = selected === optionIndex;
                    const showCorrect =
                      isGraded && optionIndex === question.correctIndex;
                    const showIncorrect = isGraded && isSelected && !isCorrect;
                    return (
                      <label
                        key={optionIndex}
                        className={cn(
                          "report-quiz__option",
                          isSelected && "report-quiz__option--selected",
                          showCorrect && "report-quiz__option--correct",
                          showIncorrect && "report-quiz__option--incorrect",
                        )}
                      >
                        <input
                          type="radio"
                          name={`report-quiz-${questionIndex}`}
                          checked={isSelected}
                          onChange={() =>
                            setSelections((current) => ({
                              ...current,
                              [questionIndex]: optionIndex,
                            }))
                          }
                        />
                        <span
                          dangerouslySetInnerHTML={{ __html: optionHtml }}
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {isGraded ? (
                <p
                  className={cn(
                    "report-quiz__explanation",
                    isCorrect
                      ? "report-quiz__explanation--correct"
                      : "report-quiz__explanation--incorrect",
                  )}
                >
                  {isCorrect ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span
                    dangerouslySetInnerHTML={{ __html: question.explanationHtml }}
                  />
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="report-quiz__footer">
        {isGraded ? (
          <>
            <p
              className={cn(
                "report-quiz__result",
                passed
                  ? "report-quiz__result--pass"
                  : "report-quiz__result--fail",
              )}
              role="status"
            >
              {score} of {quiz.questions.length} correct —{" "}
              {passed ? "passed" : `below the ${quiz.passThreshold} required`}
            </p>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Retake
            </Button>
          </>
        ) : (
          <>
            <p className="report-quiz__progress">
              {answeredCount} of {quiz.questions.length} answered
            </p>
            <Button
              size="sm"
              disabled={answeredCount < quiz.questions.length}
              onClick={() => setIsGraded(true)}
            >
              Grade quiz
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
