"""Removing a catalogue row that should never have existed.

The upload flow creates a catalogue row from whatever make/model it is given,
so a trim name typed into the model box becomes its own car — a "Sigma" sitting
in New Cars beside the Fronx it is a trim of. Nothing could remove it: this
router could create a car, edit one, and delete a *variant*, but never delete
the car. A mistake made in one click was permanent and visible to buyers.

What must NOT follow from adding a delete is the interesting half. A catalogue
correction must not be able to destroy a seller's advert, and must not take an
applicant's loan record with it.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.car import Car
from models.car_variant import CarVariant, VariantSource, VariantStatus
from models.listing import Listing, ListingType
from models.user import User, UserRole


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_user] = lambda: User(
        email="admin@gaadiiq.test", role=UserRole.admin, is_active=True, is_verified=True,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, session_factory
    app.dependency_overrides.clear()


async def _car(session_factory, make="Maruti Suzuki", model="Sigma", year=2026) -> uuid.UUID:
    async with session_factory() as db:
        car = Car(make=make, model=model, year=year, ex_showroom_price=685000)
        db.add(car)
        await db.commit()
        return car.id


async def _listing(session_factory, car_id: uuid.UUID, count: int = 1) -> None:
    """A real advert, with the seller row its foreign key points at.

    listings.seller_id is NOT NULL and references users.id. Inserting a listing
    with seller_id=None passes on nothing and fails on everything — the sort of
    fixture the engineering notes call out as the reason twelve test files are
    excluded from the Postgres job.
    """
    async with session_factory() as db:
        seller = User(
            id=uuid.uuid4(), email=f"seller-{uuid.uuid4().hex[:8]}@example.com",
            hashed_password=None, role=UserRole.seller, is_active=True, is_verified=True,
        )
        db.add(seller)
        await db.flush()
        for _ in range(count):
            db.add(Listing(
                car_id=car_id, seller_id=seller.id, listing_type=ListingType.new,
                price=700000, km_driven=0,
            ))
        await db.commit()


@pytest.mark.asyncio
async def test_a_wrongly_created_car_can_be_removed(client):
    # The reported case: a trim name that became its own model.
    c, session_factory = client
    car_id = await _car(session_factory)

    resp = await c.delete(f"/cars/{car_id}")

    assert resp.status_code == 204, resp.text
    async with session_factory() as db:
        assert (await db.execute(select(Car).where(Car.id == car_id))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_its_trims_go_with_it(client):
    # A trim has no meaning without its model; leaving them strands rows
    # nothing reads.
    c, session_factory = client
    car_id = await _car(session_factory)
    async with session_factory() as db:
        db.add(CarVariant(
            car_id=car_id, name="Sigma MT", ex_showroom_price=685000,
            status=VariantStatus.published, source=VariantSource.manual, sort_order=0,
        ))
        await db.commit()

    assert (await c.delete(f"/cars/{car_id}")).status_code == 204

    async with session_factory() as db:
        left = (await db.execute(
            select(CarVariant).where(CarVariant.car_id == car_id)
        )).scalars().all()
        assert left == []


@pytest.mark.asyncio
async def test_it_refuses_while_a_seller_has_advertised_against_it(client):
    """The safety property worth having.

    listings.car_id carries no ON DELETE, so the database would refuse anyway —
    but with an integrity error rather than a sentence. An admin tidying the
    catalogue must not be able to destroy somebody's advert, and must be told
    that is the reason.
    """
    c, session_factory = client
    car_id = await _car(session_factory, model="Fronx")
    await _listing(session_factory, car_id)

    resp = await c.delete(f"/cars/{car_id}")

    assert resp.status_code == 409, resp.text
    assert "listing" in resp.json()["detail"].lower()

    async with session_factory() as db:
        assert (await db.execute(select(Car).where(Car.id == car_id))).scalar_one_or_none()


@pytest.mark.asyncio
async def test_the_refusal_says_how_many(client):
    # "Remove those listings first" is only actionable if the admin knows how
    # many they are looking for.
    c, session_factory = client
    car_id = await _car(session_factory, model="Baleno")
    await _listing(session_factory, car_id, count=3)

    detail = (await c.delete(f"/cars/{car_id}")).json()["detail"]

    assert "3" in detail


@pytest.mark.asyncio
async def test_an_unknown_car_is_a_404_not_a_500(client):
    c, _ = client

    assert (await c.delete(f"/cars/{uuid.uuid4()}")).status_code == 404


@pytest.mark.asyncio
async def test_in_production_a_signed_out_caller_cannot_delete(client, monkeypatch):
    # Outside production get_admin_user hands a credential-less caller a
    # synthetic admin, which is pre-existing and applies to every admin route.
    # Where it matters, this must be closed.
    c, session_factory = client
    car_id = await _car(session_factory, model="Ignis")
    app.dependency_overrides.pop(get_admin_user, None)
    monkeypatch.setattr(settings, "environment", "production")

    resp = await c.delete(f"/cars/{car_id}")

    assert resp.status_code in (401, 403), resp.text
    async with session_factory() as db:
        assert (await db.execute(select(Car).where(Car.id == car_id))).scalar_one_or_none()
