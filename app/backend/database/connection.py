"""
Database Connection Management for FastAPI Backend

Adapted from Streamlit POC (../../app/database/connection.py)
Uses connection pooling for efficient database access.
Reads configuration from environment variables.

Provides both:
- Legacy psycopg2 connection pool (for existing raw SQL code)
- SQLAlchemy sessions (for new ORM-based code)
"""

import psycopg2
from psycopg2 import pool
import os
from contextlib import contextmanager
from typing import Optional, Generator, Any

from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import sessionmaker, Session
from sqlmodel import SQLModel

# ============================================================================
# Legacy psycopg2 Connection Pool
# ============================================================================

# Initialize connection pool
_connection_pool: Optional[pool.SimpleConnectionPool] = None


def get_database_url() -> str:
    """
    Get database URL from centralized config.

    Returns:
        Database URL string for SQLAlchemy
    """
    # Import here to avoid circular imports and allow scripts to work without full config
    try:
        from config import settings
        return settings.database_url
    except ImportError:
        # Fallback for scripts that don't have config available
        host = os.getenv('DB_HOST', 'localhost')
        port = os.getenv('DB_PORT', '5432')
        database = os.getenv('DB_NAME', 'canopy')
        user = os.getenv('DB_USER', 'postgres')
        password = os.getenv('DB_PASSWORD', 'password')
        sslmode = os.getenv('DB_SSLMODE', '')

        url = f"postgresql://{user}:{password}@{host}:{port}/{database}"
        if sslmode:
            url += f"?sslmode={sslmode}"
        return url


def get_connection_pool() -> Optional[pool.SimpleConnectionPool]:
    """
    Get or create the connection pool.

    Reads database configuration from environment variables:
    - DB_HOST: Database host (default: localhost)
    - DB_PORT: Database port (default: 5432)
    - DB_NAME: Database name (default: canopy)
    - DB_USER: Database user (default: postgres)
    - DB_PASSWORD: Database password (default: password)
    - DB_SSLMODE: SSL mode (optional, required for Neon)

    Returns:
        Connection pool or None if creation failed
    """
    global _connection_pool

    if _connection_pool is None:
        try:
            # Get credentials from environment variables
            connection_params = {
                'host': os.getenv('DB_HOST', 'localhost'),
                'port': int(os.getenv('DB_PORT', '5432')),
                'database': os.getenv('DB_NAME', 'canopy'),
                'user': os.getenv('DB_USER', 'postgres'),
                'password': os.getenv('DB_PASSWORD', 'password')
            }

            # Add SSL mode if specified (required for Neon production)
            sslmode = os.getenv('DB_SSLMODE')
            if sslmode:
                connection_params['sslmode'] = sslmode

            # Create connection pool with 2-10 connections
            _connection_pool = pool.SimpleConnectionPool(
                minconn=2,
                maxconn=10,
                **connection_params
            )

            print(f"✅ Database connection pool created: {connection_params['host']}/{connection_params['database']}")

        except Exception as e:
            print(f"❌ Error creating connection pool: {e}")
            import traceback
            traceback.print_exc()
            _connection_pool = None

    return _connection_pool


def get_db_connection() -> Any:
    """
    Get a connection from the pool with health checking.

    Returns:
        Database connection or None if unavailable
    """
    try:
        conn_pool = get_connection_pool()
        if conn_pool:
            conn = conn_pool.getconn()

            # Validate the connection before returning it
            if conn and conn.closed:
                print("⚠️ Got closed connection from pool, removing it")
                try:
                    conn_pool.putconn(conn, close=True)
                except:
                    pass
                # Try to get a fresh connection
                conn = conn_pool.getconn()

            # Additional health check - test the connection with a simple query
            if conn and not conn.closed:
                try:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                except (psycopg2.InterfaceError, psycopg2.OperationalError) as e:
                    print(f"⚠️ Connection health check failed: {e}, getting new connection")
                    try:
                        conn_pool.putconn(conn, close=True)
                    except:
                        pass
                    # Get a fresh connection
                    conn = conn_pool.getconn()

            return conn
        return None
    except Exception as e:
        print(f"❌ Error getting connection from pool: {e}")
        return None


def return_db_connection(conn: Any) -> None:
    """
    Return a connection to the pool.

    Args:
        conn: Database connection to return
    """
    try:
        conn_pool = get_connection_pool()
        if conn_pool and conn:
            conn_pool.putconn(conn)
    except Exception as e:
        print(f"❌ Error returning connection to pool: {e}")


@contextmanager
def get_db_cursor() -> Generator[Any, None, None]:
    """
    Context manager for database operations with connection pooling.

    Automatically handles:
    - Getting connection from pool
    - Creating cursor
    - Committing successful transactions
    - Rolling back failed transactions
    - Returning connection to pool

    Usage:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM surveys")
            results = cursor.fetchall()

    Yields:
        Database cursor

    Raises:
        Exception: If database connection fails or query errors occur
    """
    conn = get_db_connection()
    if conn:
        cursor = None
        try:
            # Check if connection is still open before creating cursor
            if conn.closed:
                raise psycopg2.InterfaceError("Connection is closed")

            cursor = conn.cursor()
            yield cursor
            conn.commit()

        except (psycopg2.InterfaceError, psycopg2.OperationalError) as e:
            # Connection-related errors - close the bad connection
            print(f"⚠️ Connection error: {e}")
            if not conn.closed:
                conn.rollback()
            # Mark connection as closed so it's removed from pool
            try:
                conn_pool = get_connection_pool()
                if conn_pool:
                    conn_pool.putconn(conn, close=True)
            except:
                pass
            raise Exception(f"Database connection error: {e}")

        except Exception as e:
            if not conn.closed:
                conn.rollback()
            raise e

        finally:
            if cursor:
                try:
                    cursor.close()
                except:
                    pass
            if not conn.closed:
                return_db_connection(conn)  # Return to pool instead of closing
    else:
        raise Exception("Failed to connect to database")


def close_connection_pool() -> None:
    """
    Close all connections in the pool.
    Should be called on application shutdown.
    """
    global _connection_pool
    if _connection_pool:
        try:
            _connection_pool.closeall()
            print("✅ Database connection pool closed")
        except Exception as e:
            print(f"❌ Error closing connection pool: {e}")
        finally:
            _connection_pool = None


# ============================================================================
# SQLAlchemy Engine and Sessions (for ORM usage)
# ============================================================================

# Initialize SQLAlchemy engine and session factory
_engine = None
_SessionLocal = None


def get_engine() -> Engine:
    """
    Get or create the SQLAlchemy engine.

    Returns:
        SQLAlchemy engine instance
    """
    global _engine
    if _engine is None:
        database_url = get_database_url()
        _engine = create_engine(
            database_url,
            pool_pre_ping=True,  # Verify connections before using
            pool_recycle=300,  # Recycle connections older than 5 min (Neon pooler reaps idle sockets)
            pool_size=5,
            max_overflow=10,
            echo=False  # Set to True for SQL query logging
        )
        print(f"✅ SQLAlchemy engine created: {database_url.split('@')[1] if '@' in database_url else database_url}")
    return _engine


def get_session_factory() -> sessionmaker:  # type: ignore[type-arg, unused-ignore]
    """
    Get or create the SQLAlchemy session factory.

    Returns:
        Session factory (sessionmaker instance)
    """
    global _SessionLocal
    if _SessionLocal is None:
        engine = get_engine()
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _SessionLocal


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that provides a database session.

    Usage:
        @router.get("/items")
        async def get_items(db: Session = Depends(get_db)):
            items = db.query(Item).all()
            return items

    Yields:
        SQLAlchemy Session instance

    The session is automatically closed after the request completes.
    """
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def close_engine() -> None:
    """
    Close the SQLAlchemy engine.
    Should be called on application shutdown.
    """
    global _engine, _SessionLocal
    if _engine:
        try:
            _engine.dispose()
            print("✅ SQLAlchemy engine closed")
        except Exception as e:
            print(f"❌ Error closing engine: {e}")
        finally:
            _engine = None
            _SessionLocal = None
