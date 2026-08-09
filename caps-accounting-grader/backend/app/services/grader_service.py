import os
import json
import logging
from typing import Dict, Any, List
from anthropic import Anthropic
from app.models.schema import GradeReport, QuestionGradeResult
from app.config import settings

logger = logging.getLogger(__name__)

class CAPSGraderService:
    def __init__(self):
        """
        Initializes the Anthropic Claude Client.
        Requires ANTHROPIC_API_KEY in backend/.env.
        """
        api_key = settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY is missing. Grader service will fail until configured.")
            self.client = None
        else:
            self.client = Anthropic(api_key=api_key)
            logger.info("Anthropic Client initialized successfully for CAPS Accounting Grader.")

    def _build_system_prompt(self) -> str:
        """
        Constructs the system prompt with strict CAPS South Africa marking principles.
        """
        return """
You are a Senior South African National Senior Certificate (NSC) Accounting Examiner for CAPS Grades 10, 11, and 12.
Your task is to grade handwritten or typed student scripts against an official Department of Basic Education (DBE) Memorandum.

CRITICAL SOUTH AFRICAN CAPS MARKING RULES:
1. METHOD MARKS (marked with  or M):
   - Always award method marks if the student applied the correct operation (e.g. adding, subtracting, or applying a ratio per memo), EVEN IF their previous working figure was wrong.
   - Inspect the reasonableness of the answer. Check that at least one part of the operation is correct before awarding the method mark.
   - Never award a method mark if the numerator and denominator are swapped in calculations/ratios.

2. FOREIGN / ALIEN ITEMS (Deductions):
   - Penalize foreign items ONLY if the student is not already losing marks for that specific item elsewhere.
   - Do not allow the total mark for a question to become a negative score.

3. BRACKETS AND SIGNS:
   - In Financial Statements (Income Statement, Balance Sheet, Cash Flow Statement), cash outflows, expenses, and items to be deducted MUST be in brackets (e.g., (15 000)).
   - If no + or - sign or bracket is provided, assume the figure is positive. Flag missing brackets as a presentation error.

4. GENERAL LEDGER DETAILS VS AMOUNTS:
   - Award separate marks for correct Account Details (e.g., "Bank", "Debtors Control") and correct numeric amounts.
   - Ensure the student wrote the opposite ledger entry account correctly.

5. GENERAL ACCURACY & PRE-ADJUSTMENT FIGURES:
   - If a student shows a pre-adjustment figure as their final answer, allocate part-marks for the working, but DO NOT allocate the method mark for the final answer.
   - Give full marks for a correct final answer even if workings are brief, unless the question explicitly states "Show Workings".

YOUR OUTPUT FORMAT:
You MUST respond with a valid, clean JSON object matching the requested output schema exactly. Do not add conversational markdown wrappers outside the JSON block.
"""

    def grade_script(
        self, 
        grade_level: int, 
        memo_content: str, 
        student_ocr_content: str
    ) -> GradeReport:
        """
        Sends the Memorandum and Learner Script OCR text to Claude 3.5 Sonnet to perform evaluation.
        Returns a structured Pydantic GradeReport object.
        """
        if not self.client:
            raise RuntimeError("Anthropic API Client is not initialized. Check ANTHROPIC_API_KEY in .env.")

        user_prompt = f"""
EVALUATION REQUEST: CAPS GRADE {grade_level} ACCOUNTING EXAM

=== OFFICIAL MEMORANDUM ===
{memo_content}

=== LEARNER SCRIPT (OCR EXTRACTED) ===
{student_ocr_content}

INSTRUCTIONS:
Evaluate every question present in the student script against the memorandum.
Follow all CAPS marking rules (Method Marks, Foreign Items, Ledger Details, Brackets).

Provide your response in the following strict JSON schema structure:
{{
  "grade_level": {grade_level},
  "total_obtained": <float_total_marks_awarded>,
  "total_possible": <float_total_possible_marks>,
  "percentage": <float_calculated_percentage>,
  "question_breakdown": [
    {{
      "question_number": "Question 1.1",
      "marks_awarded": 4.0,
      "max_marks": 5.0,
      "method_marks_awarded": true,
      "detailed_feedback": "Learner got the final figure wrong due to an addition error on pre-adjustment trial balance, but correctly applied method marks for stock deficit subtraction.",
      "identified_error_type": "Calculation error"
    }}
  ],
  "general_teacher_summary": "Overall diagnostic summary highlighting learner strengths, ledger weaknesses, and CAPS recommendations."
}}
"""

        try:
            logger.info(f"Submitting Grade {grade_level} paper to Claude 3.5 Sonnet for evaluation...")
            
            # Using Claude 3.5 Sonnet for spatial ledger formatting & CAPS rules processing
            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4000,
                temperature=0.1,  # Low temperature for consistent grading evaluation
                system=self._build_system_prompt(),
                messages=[
                    {"role": "user", "content": user_prompt}
                ]
            )

            response_text = response.content[0].text.strip()
            
            # Clean response if enclosed in markdown code blocks
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_text = response_text.strip()

            # Parse JSON string into Python dict
            data = json.loads(response_text)

            # Validate output against Pydantic GradeReport model
            report = GradeReport(**data)
            logger.info(f"Grading completed successfully. Score: {report.total_obtained}/{report.total_possible} ({report.percentage}%)")
            
            return report

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude JSON response: {e}")
            raise ValueError(f"AI returned invalid JSON structure: {e}")
        except Exception as e:
            logger.error(f"Error during AI grading execution: {str(e)}")
            raise e


# Singleton instance for export
grader_service = CAPSGraderService()