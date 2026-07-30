"""
Reading metadata out of a filename (BR-004).

Photography arrives named, not tagged. Retyping make/model/variant for two
hundred files is the reason bulk uploads do not happen, so parsing the name is
the difference between a usable admin screen and an afternoon of data entry.

Everything here is a *suggestion* the admin can override, which is why the
tests care most about not guessing wrongly: a blank field is cheap, and a wrong
make silently attached to three hundred images is not.
"""
import pytest

from models.vehicle_media import ImageCategory
from services.filename_metadata import parse


class TestTheBrdExampleSuite:
    def test_the_documented_example_parses_exactly(self):
        # Straight from the BRD: Tata_Nexon_FearlessPlus_Front_2025.webp
        m = parse("Tata_Nexon_FearlessPlus_Front_2025.webp")
        assert m.make == "Tata"
        assert m.model == "Nexon"
        assert m.variant == "Fearless Plus"
        assert m.model_year == 2025
        assert m.image_category is ImageCategory.exterior_front


class TestSeparatorStylesSuite:
    @pytest.mark.parametrize("name", [
        "Tata_Nexon_Front_2025.webp",
        "Tata-Nexon-Front-2025.jpg",
        "Tata Nexon Front 2025.png",
        "TataNexonFront2025.webp",       # camelCase, no separators at all
        "tata_nexon_front_2025.TIFF",
    ])
    def test_every_common_naming_style_is_read(self, name):
        m = parse(name)
        assert (m.make, m.model) == ("Tata", "Nexon"), name
        assert m.image_category is ImageCategory.exterior_front


class TestAmbiguitySuite:
    """Where a careless parser does damage."""

    def test_a_camera_filename_is_not_attributed_to_a_brand(self):
        # Regression: "MG" was found inside "IMG_20240513" and filed a holiday
        # snap under a manufacturer. Makes must match whole words.
        assert parse("IMG_20240513_112233.jpg").make is None

    def test_a_two_word_make_beats_the_one_word_inside_it(self):
        assert parse("Maruti-Suzuki-Dzire-Front-2025.jpg").make == "Maruti Suzuki"
        # And the bare form still resolves to the shorter make.
        assert parse("Suzuki-Jimny-Front.jpg").make == "Suzuki"

    def test_category_words_do_not_leak_into_the_variant(self):
        # Regression: variant came back as "ZXi Plus Front Quarter".
        m = parse("Maruti-Suzuki-Dzire-ZXi-Plus-FrontQuarter-2025.jpg")
        assert m.variant == "ZXi Plus"
        assert m.image_category is ImageCategory.front_quarter

    def test_the_longer_category_wins(self):
        assert parse("Tata_Nexon_RearQuarter.jpg").image_category is ImageCategory.rear_quarter
        assert parse("Tata_Nexon_Rear.jpg").image_category is ImageCategory.exterior_rear

    def test_a_resolution_is_not_read_as_a_year(self):
        # 1080 is below the 1990 floor, so it cannot be a model year.
        assert parse("Tata_Nexon_Front_1080.jpg").model_year is None

    def test_an_unrecognised_name_yields_no_make_rather_than_a_guess(self):
        m = parse("random-holiday-photo.jpg")
        assert m.make is None
        assert m.model_year is None
        assert m.image_category is None


class TestRobustnessSuite:
    @pytest.mark.parametrize("name", ["", "   ", ".jpg", "....", None])
    def test_degenerate_names_do_not_raise(self, name):
        parse(name or "")

    def test_a_multi_word_variant_survives_whole(self):
        # Truncating "Fearless Plus DCA" to one word would misfile the image.
        assert parse("Tata_Nexon_Fearless_Plus_DCA_Front_2025.png").variant == "Fearless Plus DCA"

    def test_colour_is_recognised_and_kept_out_of_the_variant(self):
        m = parse("Tata_Nexon_Fearless_Red_Front_2025.png")
        assert m.colour == "Red"
        assert "Red" not in (m.variant or "")

    def test_interior_names_map_to_the_cabin_categories(self):
        assert parse("mahindra_xuv700_dashboard.png").image_category is ImageCategory.interior_dashboard
        assert parse("mahindra_xuv700_boot.png").image_category is ImageCategory.boot_space
        assert parse("mahindra_xuv700_enginebay.png").image_category is ImageCategory.engine_bay
        assert parse("mahindra_xuv700_360.png").image_category is ImageCategory.three_sixty
