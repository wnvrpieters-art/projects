from typing import List, Optional
from pydantic import BaseModel, Field

# --- INPUT SCHEMAS ---

class QuestionMemo(BaseModel):
    question_number: str = Field(..., description="e.g. Question 1.1, Question 2.3")
    topic: str = Field(..., description="e.g. Bank Reconciliation, Financial Statements, Cost Accounting")
    max_marks: int = Field(..., description="Total marks allocated to this question")
    memo_solution: str = Field(..., description="Official solution text, working, or ledger entry from memo")
    caps_marking_rules: Optional[List[str]] = Field(
        default=[], 
        description="Specific marking notes e.g., 'Award 1 mark for method even if calculation is wrong'"
    )

class ExamMemo(BaseModel):
    grade: int = Field(..., ge=10, le=12, description="CAPS Grade level (10, 11, or 12)")
    term_or_paper: str = Field(..., description="e.g. Paper 1 November, Term 2 Control Test")
    questions: List[QuestionMemo]

class StudentAnswer(BaseModel):
    question_number: str
    extracted_handwriting: str = Field(..., description="OCR extracted text or numbers from student paper")
    workings_shown: Optional[str] = Field(None, description="Calculations or scratchwork detected in working box")

class LearnerScript(BaseModel):
    student_id: Optional[str] = None
    grade: int
    answers: List[StudentAnswer]


# --- OUTPUT / EVALUATION SCHEMAS ---

class QuestionGradeResult(BaseModel):
    question_number: str
    marks_awarded: float = Field(..., description="Marks given to the learner")
    max_marks: float = Field(..., description="Maximum possible marks")
    method_marks_awarded: bool = Field(False, description="Whether method marks were applied")
    detailed_feedback: str = Field(..., description="Explanation of errors made or marks awarded")
    identified_error_type: Optional[str] = Field(
        None, 
        description="e.g. Calculation error, Principle error, Foreign item included, Missing bracket"
    )

class GradeReport(BaseModel):
    grade_level: int
    total_obtained: float
    total_possible: float
    percentage: float
    question_breakdown: List[QuestionGradeResult]
    general_teacher_summary: str = Field(..., description="Overall diagnostic summary for the student/teacher")