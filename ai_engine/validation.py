from pydantic import BaseModel, Field, field_validator


class EngineInput(BaseModel):
    feature_key: str = Field(min_length=1, max_length=80)
    user_input: str = Field(min_length=1, max_length=5000)

    @field_validator("user_input")
    @classmethod
    def non_whitespace(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("input_must_not_be_blank")
        return value.strip()


class EngineOutput(BaseModel):
    text: str = Field(min_length=1, max_length=12000)

    @field_validator("text")
    @classmethod
    def non_whitespace(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("output_must_not_be_blank")
        return value.strip()
