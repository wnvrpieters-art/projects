import logging
from typing import Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models.schema import GradeReport
from app.services.ocr_service import ocr_service
from app.services.grader_service import grader_service

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("caps_grader")

# Initialize FastAPI App
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Automated AI Grading Engine tailored to South African CAPS Grade 10-12 Accounting.",
    version="1.0.0",
)

# Enable CORS for frontend integration (React/Next.js/Flutter)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["Health Check"])
async def root():
    """Health check endpoint."""
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "message": "CAPS Accounting AI Grader API is running."
    }


@app.post(
    f"{settings.API_V1_STR}/grade", 
    response_model=GradeReport, 
    tags=["Grading Engine"],
    status_code=status.HTTP_200_OK
)
async def grade_exam_script(
    grade_level: int = Form(..., ge=10, le=12, description="CAPS Grade level (10, 11, or 12)"),
    memo_file: UploadFile = File(..., description="Official Memorandum PDF file"),
    student_file: UploadFile = File(..., description="Handwritten or typed learner answer script (PDF or Image)")
):
    """
    **Upload Exam Documents & Grade Script**
    
    - Accepts `memo_file` (official memo PDF) and `student_file` (learner script).
    - Runs OCR text and table extraction.
    - Evaluates student answers against CAPS accounting rules using Anthropic Claude 3.5 Sonnet.
    - Returns structured diagnostic feedback and marks per question.
    """
    logger.info(f"Received grading request for CAPS Grade {grade_level}.")

    # 1. Validate File Extensions
    allowed_memo_types = ["application/pdf"]
    allowed_student_types = ["application/pdf", "image/jpeg", "image/png", "image/jpg"]

    if memo_file.content_type not in allowed_memo_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Memorandum must be a digital PDF file."
        )

    if student_file.content_type not in allowed_student_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student script must be a PDF or Image file (JPG/PNG)."
        )

    try:
        # Read file bytes from uploads
        memo_bytes = await memo_file.read()
        student_bytes = await student_file.read()

        # 2. Extract Text & Tables from Official Memo (pdfplumber)
        logger.info("Processing Memorandum document...")
        memo_extracted = ocr_service.process_pdf_memo(memo_bytes)
        
        # Combine page content into a unified memorandum string
        memo_text = "\n\n".join([page["combined_text"] for page in memo_extracted])

        if not memo_text.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not extract readable text from the Memorandum PDF."
            )

        # 3. Extract Text & Handwriting from Student Script (Google Vision / OCR)
        logger.info("Processing Learner Script document...")
        if student_file.content_type == "application/pdf":
            # Digital or scanned PDF script
            student_pages = ocr_service.process_pdf_memo(student_bytes)
            student_text = "\n\n".join([p["combined_text"] for p in student_pages])
        else:
            # Image input (Handwritten paper page)
            student_extracted = ocr_service.process_handwritten_script(student_bytes)
            student_text = student_extracted["formatted_output"]

        if not student_text.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not extract text or handwriting from the Learner Script."
            )

        # 4. Execute AI Evaluation via Claude 3.5 Sonnet
        logger.info(f"Submitting extracted text to CAPS Grader Service for Grade {grade_level}...")
        report: GradeReport = grader_service.grade_script(
            grade_level=grade_level,
            memo_content=memo_text,
            student_ocr_content=student_text
        )

        return report

    except HTTPException as http_ex:
        raise http_ex
    except Exception as e:
        logger.error(f"Unhandled error in grading endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while grading the paper: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)