"""
Model unit tests using an in-memory SQLite database.
Tests model instantiation, relationships, and field defaults.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from db.base import Base
from models import Car, Dealer, Listing, LoanInquiry, TestDriveBooking, User
from models.car import BodyType, FuelType, Transmission
from models.listing import ListingCondition, ListingType
from models.loan_inquiry import EmploymentType, LoanStatus
from models.test_drive_booking import BookingStatus
from models.user import UserRole

# SQLite in-memory for tests (no Postgres needed)
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_user(db_session: AsyncSession):
    user = User(email="test@gaadiiq.com", full_name="Test User", role=UserRole.buyer)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    assert user.id is not None
    assert user.email == "test@gaadiiq.com"
    assert user.role == UserRole.buyer
    assert user.is_active is True
    assert user.is_verified is False


@pytest.mark.asyncio
async def test_create_car(db_session: AsyncSession):
    car = Car(
        make="Maruti Suzuki",
        model="Swift",
        variant="ZXi+",
        year=2023,
        fuel_type=FuelType.petrol,
        transmission=Transmission.manual,
        body_type=BodyType.hatchback,
        seating_capacity=5,
        engine_cc=1197,
    )
    db_session.add(car)
    await db_session.commit()
    await db_session.refresh(car)

    assert car.id is not None
    assert car.make == "Maruti Suzuki"
    assert car.fuel_type == FuelType.petrol
    assert car.year == 2023


@pytest.mark.asyncio
async def test_create_dealer(db_session: AsyncSession):
    user = User(email="dealer@gaadiiq.com", role=UserRole.dealer)
    db_session.add(user)
    await db_session.flush()

    dealer = Dealer(user_id=user.id, business_name="Star Motors", city="Mumbai", state="MH")
    db_session.add(dealer)
    await db_session.commit()
    await db_session.refresh(dealer)

    assert dealer.id is not None
    assert dealer.business_name == "Star Motors"
    assert dealer.is_verified is False


@pytest.mark.asyncio
async def test_create_listing(db_session: AsyncSession):
    user = User(email="seller@gaadiiq.com", role=UserRole.seller)
    car = Car(make="Hyundai", model="Creta", year=2022, fuel_type=FuelType.diesel)
    db_session.add_all([user, car])
    await db_session.flush()

    listing = Listing(
        car_id=car.id,
        seller_id=user.id,
        listing_type=ListingType.used,
        price=1200000,
        km_driven=35000,
        condition=ListingCondition.good,
        city="Bangalore",
    )
    db_session.add(listing)
    await db_session.commit()
    await db_session.refresh(listing)

    assert listing.id is not None
    assert listing.price == 1200000
    assert listing.is_active is True
    assert listing.is_featured is False
    assert listing.views_count == 0


@pytest.mark.asyncio
async def test_test_drive_booking(db_session: AsyncSession):
    user = User(email="buyer@gaadiiq.com", role=UserRole.buyer)
    car = Car(make="Tata", model="Nexon", year=2023, fuel_type=FuelType.electric)
    db_session.add_all([user, car])
    await db_session.flush()

    listing = Listing(
        car_id=car.id, seller_id=user.id, listing_type=ListingType.new, price=1500000
    )
    db_session.add(listing)
    await db_session.flush()

    booking = TestDriveBooking(listing_id=listing.id, user_id=user.id)
    db_session.add(booking)
    await db_session.commit()
    await db_session.refresh(booking)

    assert booking.id is not None
    assert booking.status == BookingStatus.pending


@pytest.mark.asyncio
async def test_loan_inquiry(db_session: AsyncSession):
    user = User(email="loan@gaadiiq.com", role=UserRole.buyer)
    car = Car(make="Kia", model="Seltos", year=2024, fuel_type=FuelType.petrol)
    db_session.add_all([user, car])
    await db_session.flush()

    listing = Listing(
        car_id=car.id, seller_id=user.id, listing_type=ListingType.new, price=1800000
    )
    db_session.add(listing)
    await db_session.flush()

    loan = LoanInquiry(
        listing_id=listing.id,
        user_id=user.id,
        loan_amount=1400000,
        tenure_months=60,
        employment_type=EmploymentType.salaried,
        annual_income=800000,
        partner_ref="HDFC-001",
    )
    db_session.add(loan)
    await db_session.commit()
    await db_session.refresh(loan)

    assert loan.id is not None
    assert loan.status == LoanStatus.submitted
    assert loan.partner_ref == "HDFC-001"
