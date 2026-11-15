from tools import about, answer


def test_answer_returns_the_query() -> None:
    assert answer("weather in Oslo")["query"] == "weather in Oslo"


def test_about_names_the_paid_tool() -> None:
    assert about()["paid"] == "__TOOL_NAME__"
