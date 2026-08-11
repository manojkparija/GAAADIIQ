"""The roadside repair marketplace, as a migration rather than a hand-run file.

These tables — mechanics, service_requests, whatsapp_messages, and the
settlement columns on payments — shipped as `schema_setup_batch6_marketplace.sql`
at the repo root and were applied to production by hand. That left a deploy
unable to carry its own schema: the code for a feature could reach production
while the tables it needs did not, which is exactly how a merge produced 500s
reading `relation "loan_applications" does not exist`.

The DDL here is the batch file's, statement for statement, so a database built
from migrations alone matches the one built by running the file. Every statement
is guarded, so this is a no-op on the production database that already has them.

The SQL files stay in the repo as the record of what was actually run. New
tables belong here.

Revision ID: 0025
Revises: 0024
"""
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mechanic_status') THEN
                CREATE TYPE mechanic_status AS ENUM (
                    'pending_verification', 'active', 'suspended', 'rejected'
                );
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_status') THEN
                CREATE TYPE service_request_status AS ENUM (
                    'open', 'assigned', 'in_progress', 'awaiting_payment',
                    'paid', 'completed', 'cancelled'
                );
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_template') THEN
                CREATE TYPE whatsapp_template AS ENUM (
                    'payment_receipt', 'mechanic_assigned', 'service_request_raised'
                );
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_status') THEN
                CREATE TYPE whatsapp_status AS ENUM (
                    'queued', 'sent', 'delivered', 'read', 'failed'
                );
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mechanics (
            id uuid PRIMARY KEY,

            -- Nullable: ops can onboard a mechanic before they ever sign in, so the
            -- login is an attachment rather than the identity of the row.
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,

            -- Identity
            full_name varchar(150) NOT NULL,
            shop_name varchar(200),
            phone varchar(15) NOT NULL UNIQUE,
            whatsapp_phone varchar(15),
            email varchar(255),

            -- Address
            address_line1 varchar(255) NOT NULL,
            address_line2 varchar(255),
            city varchar(100) NOT NULL,
            state varchar(100) NOT NULL,
            area_pincode varchar(6) NOT NULL,

            -- Location. Plain floats, not PostGIS: the matching radius is tens of km,
            -- where a bounding box plus haversine is accurate enough, and it keeps the
            -- SQLite-backed test suite working without an extension.
            latitude double precision,
            longitude double precision,
            service_radius_km integer NOT NULL DEFAULT 15,

            -- KYC. See the module header for why the Aadhaar number is absent.
            pan_number varchar(10) NOT NULL,
            aadhaar_last4 varchar(4) NOT NULL,
            aadhaar_hash varchar(64) NOT NULL UNIQUE,
            aadhaar_vault_ref varchar(64),

            -- Payout
            upi_vpa varchar(120),
            bank_account_last4 varchar(4),
            bank_ifsc varchar(11),

            -- Marketplace state
            status mechanic_status NOT NULL DEFAULT 'pending_verification',
            specialisations json,
            is_available boolean NOT NULL DEFAULT TRUE,
            rating numeric(3,2),
            jobs_completed integer NOT NULL DEFAULT 0,
            verified_at varchar(40),
            rejection_reason text,

            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now()
        );
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_user_id ON mechanics(user_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_phone ON mechanics(phone);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_area_pincode ON mechanics(area_pincode);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_latitude ON mechanics(latitude);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_longitude ON mechanics(longitude);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_pan_number ON mechanics(pan_number);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_aadhaar_hash ON mechanics(aadhaar_hash);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_status ON mechanics(status);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_mechanics_status_lat_lng
            ON mechanics(status, latitude, longitude);
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS service_requests (
            id uuid PRIMARY KEY,

            -- Human-facing reference printed on the receipt, e.g. "SR-7F3A21".
            reference varchar(20) NOT NULL UNIQUE,

            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            diagnosis_id uuid REFERENCES vehicle_diagnoses(id) ON DELETE SET NULL,
            mechanic_id uuid REFERENCES mechanics(id) ON DELETE SET NULL,

            -- Vehicle. car_number is stored normalised (uppercase, no spaces).
            car_number varchar(15) NOT NULL,
            manufacturer varchar(100),
            model varchar(100),
            model_year integer,
            fuel_type varchar(30),

            -- Where the car actually is: the browser's live fix at request time, not a
            -- saved address. location_accuracy_m is the reported GPS uncertainty — a
            -- 2km fix is a different dispatch problem to a 10m one.
            latitude double precision NOT NULL,
            longitude double precision NOT NULL,
            location_accuracy_m double precision,
            address_text varchar(400),
            landmark varchar(200),
            pincode varchar(6),

            -- Callback number and receipt recipient. Held on the request because the
            -- person standing with the car is not always the account holder.
            contact_phone varchar(15),

            -- The problem
            problem_summary text NOT NULL,
            severity varchar(20),
            is_vehicle_drivable boolean,
            photo_urls json,

            -- Quote and settlement, in paise throughout so no float touches money.
            quoted_amount_paise integer,
            final_amount_paise integer,

            status service_request_status NOT NULL DEFAULT 'open',
            assigned_at timestamp with time zone,
            completed_at timestamp with time zone,
            cancelled_reason text,

            -- Straight-line km at assignment time, frozen because the mechanic's own
            -- coordinates can change afterwards.
            matched_distance_km double precision,

            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now()
        );
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_reference ON service_requests(reference);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_user_id ON service_requests(user_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_diagnosis_id ON service_requests(diagnosis_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_mechanic_id ON service_requests(mechanic_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_car_number ON service_requests(car_number);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_pincode ON service_requests(pincode);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_status ON service_requests(status);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_service_requests_status_created
            ON service_requests(status, created_at);
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS
            service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL;
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS
            mechanic_id uuid REFERENCES mechanics(id) ON DELETE SET NULL;
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_rate_bps integer;
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_paise integer;
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS mechanic_payout_paise integer;
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_payments_service_request_id ON payments(service_request_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_payments_mechanic_id ON payments(mechanic_id);
        """
    )

    op.execute(
        """
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'INR';
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_purpose') THEN
                ALTER TYPE payment_purpose ADD VALUE IF NOT EXISTS 'service_request';
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS whatsapp_messages (
            id uuid PRIMARY KEY,

            -- E.164 digits without the leading '+', as every Indian provider expects.
            to_phone varchar(15) NOT NULL,
            template whatsapp_template NOT NULL,
            variables json,

            service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
            payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,

            status whatsapp_status NOT NULL DEFAULT 'queued',
            provider varchar(30) NOT NULL DEFAULT 'meta_cloud',
            -- Correlates the provider's delivery webhook back to this row.
            provider_message_id varchar(120),

            -- UNIQUE is the real guarantee that a replayed webhook or a double-tapped
            -- "resend receipt" cannot bill the WhatsApp account twice.
            idempotency_key varchar(120) NOT NULL UNIQUE,

            attempts integer NOT NULL DEFAULT 0,
            last_error text,
            sent_at timestamp with time zone,
            delivered_at timestamp with time zone,

            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now()
        );
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_to_phone ON whatsapp_messages(to_phone);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_service_request_id
            ON whatsapp_messages(service_request_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_payment_id ON whatsapp_messages(payment_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_status ON whatsapp_messages(status);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_provider_message_id
            ON whatsapp_messages(provider_message_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_idempotency_key
            ON whatsapp_messages(idempotency_key);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_status_created
            ON whatsapp_messages(status, created_at);
        """
    )


def downgrade() -> None:
    # Order matters: whatsapp_messages and the payments columns reference
    # service_requests, which references mechanics.
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS mechanic_payout_paise;")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS commission_paise;")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS commission_rate_bps;")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS mechanic_id;")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS service_request_id;")
    op.execute("DROP TABLE IF EXISTS whatsapp_messages;")
    op.execute("DROP TABLE IF EXISTS service_requests;")
    op.execute("DROP TABLE IF EXISTS mechanics;")
    op.execute("DROP TYPE IF EXISTS whatsapp_status;")
    op.execute("DROP TYPE IF EXISTS whatsapp_template;")
    op.execute("DROP TYPE IF EXISTS service_request_status;")
    op.execute("DROP TYPE IF EXISTS mechanic_status;")
