# Registro de instalación y verificación - 2026-11-13

## Versión instalada

- Commit de aplicación instalado: `9d95366f1db5800ba09c932b7df7f2159576ca53`.
- Corrección: [PR 1](https://github.com/rogerv2-ops/loyaltyos/pull/1), revisada e integrada en `main`.
- Árbol instalado igual al candidato revisado `18be11d23dcb9d6654052c1a85a1932fae83af9b`: `13ab3cbcd2c9f1bd908ff72456ef994310c021d2`.
- Despliegue manual en Coolify terminado el 13 de noviembre de 2026 a las 07:33:42, America/Lima. El registro de importación contiene el SHA completo anterior.
- Este documento es posterior al despliegue. Su commit documental no cambia la versión instalada y no se debe presentar como desplegado.

## Cambio y control

La API de métricas de tarjetas devuelve `active`, mientras que el dashboard intentaba usar `activeCards.toLocaleString()`. El dato inexistente causaba la pantalla en blanco después del inicio de sesión. La corrección cambia el nombre leído y alinea el tipo del frontend con el contrato de la API. No añade tarjetas, puntos ni saldos ficticios y no combina monedas diferentes.

- CI y Smoke del candidato: aprobados.
- [CI](https://github.com/rogerv2-ops/loyaltyos/actions/runs/43423645986).
- [Smoke](https://github.com/rogerv2-ops/loyaltyos/actions/runs/43423646136).
- Pruebas locales de admin: 26 aprobadas, incluidas dos regresiones con cero y con un contador distinto de cero.
- La regresión reprodujo primero la excepción con el código anterior.
- Typecheck, lint de los archivos modificados y build de admin: aprobados.
- Se comprobó primero una vista local con datos simulados y, después del despliegue autorizado, la pantalla real. No son la misma evidencia.

## Verificación real

- Inicio de sesión de administrador con la contraseña existente: correcto. Identidad, rol y programa comprobados por la API.
- Dashboard real: visible, con un miembro activo, cero puntos emitidos/canjeados y cero tarjetas activas. Menú y gráfico visibles, sin pantalla en blanco.
- Cuenta de cliente de prueba creada de forma acotada e idempotente en el programa de la instalación, sin saldo ni datos de perfil inventados. Una segunda ejecución no creó duplicados.
- Se solicitó un solo enlace desde la interfaz del portal. El proveedor registró entrega a las 07:29, America/Lima.
- El enlace se usó en la prueba y creó una sesión real. Se verificó identidad y consulta de saldo cero. El enlace ya usado no se debe reutilizar: la persona debe pedir otro desde la pantalla de acceso.
- La sesión del cliente y la consulta de saldo siguieron respondiendo correctamente tras el despliegue.
- Entrega del proveedor no equivale a confirmar ubicación en la bandeja principal ni lectura humana.
- Se verificaron el montaje persistente PostgreSQL y los conteos conservados: un programa, un administrador, dos plantillas de acceso y un miembro. La copia de recuperación previa sigue presente.

## Seed y límites

El seed del repositorio es de demostración y empieza borrando datos existentes. No se ejecutó en esta instalación. El contador de tarjetas se calcula desde las tarjetas guardadas, no desde el seed; sin tarjetas devuelve cero con el nombre `active`.

No se configuraron reglas de puntos, premios, campañas, tarjetas ni datos de demostración. No se probó acumulación o canje. La verificación cubre el acceso de administrador, el dashboard y el acceso de cliente por correo con consulta de saldo, no todas las funciones comerciales de LoyaltyOS.

Se detuvieron las configuraciones adicionales por indicación del propietario. Las cuentas de administrador y de prueba se conservaron. No se cambiaron sus preferencias después de esa indicación.

## Pendientes y recursos retenidos

- El despliegue automático desde GitHub no quedó conectado ni probado. Coolify conserva un SHA explícito; no se cambió a `HEAD` ni se añadió un webhook al cerrar este trabajo.
- La publicación de imágenes sigue desactivada. Los paquetes publicados por error durante la preparación se retiraron con permisos individuales. No se afirma limpieza global de GitHub o del servidor.
- Se conservan los volúmenes de PostgreSQL/Redis, la copia de recuperación y los registros de despliegue.
- Se conservan la rama de comprobación ARM, las ramas de corrección/documentación y los registros/artefactos de comprobación existentes para revisión posterior. No se borraron por inferencia.
- Dos entradas de rutas `www.admin` siguen retenidas; no se eliminaron sin autorización individual.
- No se contrataron servicios de pago ni se usó una tarjeta. No se publicaron nuevas imágenes con la corrección.

Las evidencias que contienen direcciones personales, detalles privados del servidor o credenciales no se incluyen en este repositorio público.
