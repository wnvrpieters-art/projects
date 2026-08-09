import io
import os
import logging
from typing import Dict, List, Any, Union
import pdfplumber
from google.cloud import vision
from google.cloud.vision_v1 import types

# Set up logger
logger = logging.getLogger(__name__)

class OCRService:
    def __init__(self):
        """
        Initializes Google Cloud Vision client. 
        Requires GOOGLE_APPLICATION_CREDENTIALS environment variable set in .env.
        """
        try:
            self.vision_client = vision.ImageAnnotatorClient()
            logger.info("Google Cloud Vision Client initialized successfully.")
        except Exception as e:
            logger.warning(
                f"Google Cloud Vision Client failed to initialize. "
                f"Handwritten OCR will fall back or error until configured: {e}"
            )
            self.vision_client = None

    def process_pdf_memo(self, pdf_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Extracts typed text, tables, and structures from digital Memorandum PDFs.
        Uses pdfplumber to maintain table borders and column alignments.
        """
        pages_content = []
        
        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                for page_num, page in enumerate(pdf.pages, start=1):
                    # 1. Extract raw text
                    text = page.extract_text(layout=True) or ""
                    
                    # 2. Extract structured tables (General Ledger, Journals, Statements)
                    tables = page.extract_tables()
                    formatted_tables = []
                    
                    for table in tables:
                        cleaned_table = []
                        for row in table:
                            # Replace None with empty string and clean whitespace
                            cleaned_row = [str(cell).strip() if cell is not None else "" for cell in row]
                            if any(cleaned_row):  # Skip completely empty rows
                                cleaned_row_str = " | ".join(cleaned_row)
                                cleaned_table.append(cleaned_row_str)
                        if cleaned_table:
                            formatted_tables.append("\n".join(cleaned_table))

                    pages_content.append({
                        "page_number": page_num,
                        "text": text,
                        "tables": formatted_tables,
                        "combined_text": f"--- PAGE {page_num} ---\n{text}\n\n" + 
                                         ("\n\n[EXTRACTED TABLES]\n" + "\n\n".join(formatted_tables) if formatted_tables else "")
                    })
                    
            logger.info(f"Successfully processed digital PDF Memo ({len(pages_content)} pages).")
            return pages_content

        except Exception as e:
            logger.error(f"Error processing PDF memo: {str(e)}")
            raise e

    def process_handwritten_script(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Extracts handwritten text, working calculations, and numbers from learner scripts 
        using Google Cloud Vision's DOCUMENT_TEXT_DETECTION model.
        """
        if not self.vision_client:
            raise RuntimeError(
                "Google Cloud Vision client is not configured. Check your GOOGLE_APPLICATION_CREDENTIALS."
            )

        try:
            image = types.Image(content=image_bytes)
            
            # DOCUMENT_TEXT_DETECTION is optimized for handwriting and dense financial documents
            response = self.vision_client.document_text_detection(image=image)
            
            if response.error.message:
                raise Exception(f"Google Vision API Error: {response.error.message}")

            full_annotation = response.full_text_annotation
            extracted_text = full_annotation.text if full_annotation else ""

            # Extract block-level hierarchy (paragraphs/tables detection helper)
            structured_blocks = []
            if full_annotation:
                for page in full_annotation.pages:
                    for block_idx, block in enumerate(page.blocks):
                        block_text = ""
                        for paragraph in block.paragraphs:
                            for word in paragraph.words:
                                word_text = "".join([symbol.text for symbol in word.symbols])
                                block_text += word_text + " "
                            block_text += "\n"
                        
                        structured_blocks.append({
                            "block_id": block_idx,
                            "confidence": block.confidence,
                            "text": block_text.strip()
                        })

            return {
                "raw_text": extracted_text,
                "structured_blocks": structured_blocks,
                "formatted_output": f"[LEARNER HANDWRITING OCR OUTPUT]\n{extracted_text}"
            }

        except Exception as e:
            logger.error(f"Error processing handwritten script: {str(e)}")
            raise e

    def process_document(
        self, file_bytes: bytes, file_type: str, is_handwritten: bool = False
    ) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Main entry point for handling incoming files based on mime-type or path.
        file_type options: 'application/pdf', 'image/jpeg', 'image/png'
        """
        if file_type == "application/pdf" and not is_handwritten:
            return self.process_pdf_memo(file_bytes)
        else:
            return self.process_handwritten_script(file_bytes)


# Singleton instance for export
ocr_service = OCRService()