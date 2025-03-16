const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const md5 = require('md5');

const app = express();
const port = 3001;

// Middleware para manejar JSON
app.use(bodyParser.json());
app.use(cors()); // Habilitar CORS


// Conexión a la base de datos MySQL
/*
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  //password: 'root',
  password: '',
  database: 'zap'
});
*/


const db = mysql.createConnection({
  host: '69.49.241.56',
  user: 'opticlas_SergioAldavalde',
  password: 'Ares2021$$',
  //password: '',
  database: 'opticlas_digitalmindworks'
});


db.connect((err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('Connected to database');
});



// Ruta para manejar la autenticación de inicio de sesión
app.post('/login', (req, res) => {
  const { correo, contrasenia } = req.body;

  const contraseniamd5 = md5(contrasenia);

  const query = 'SELECT * FROM usuarios WHERE correo = ? AND contrasenia = ?';
  db.query(query, [correo, contraseniamd5], (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Error en el server', error: err });
    }

    if (result.length > 0) {
      res.json({ success: true, message: 'Logeo exitoso', userData: result[0] }); // Devolvemos el primer usuario encontrado
    } else {
      // Si las credenciales no coinciden
      res.json({ contra: contrasenia, contramd5: contraseniamd5, success: false, message: 'Correo o Contraseña invalido' });
    }
  });
});

app.post('/register/profesor', (req, res) => {
  const { correo, contrasenia, nombre, appaterno, apmaterno } = req.body;

  // Validación de campos obligatorios
  if (!correo || !contrasenia || !nombre || !appaterno || !apmaterno) {
    return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
  }

  // Verificar si el correo ya está registrado
  const checkQuery = 'SELECT * FROM usuarios WHERE correo = ?';
  db.query(checkQuery, [correo], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error en el servidor', error: err });
    }

    if (result.length > 0) {
      return res.status(400).json({ success: false, message: 'El correo ya está registrado' });
    }

    // Hash de la contraseña antes de guardarla
    const hashedPassword = md5(contrasenia);

    // Insertar nuevo usuario como 'Profesor'
    const query = 'INSERT INTO usuarios (correo, contrasenia, tipo) VALUES (?, ?, ?)';
    db.query(query, [correo, hashedPassword, 2], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Error en el servidor', error: err });
      }

      const newUserId = result.insertId;

      // Insertar en la tabla 'profesores'
      const insertProfesorQuery =
        'INSERT INTO profesores (nombre, appaterno, apmaterno, id_usuario, dias_trabajo, horainicio_trabajo, horafin_trabajo) VALUES (?, ?, ?, ?, NULL, NULL, NULL)';
      db.query(insertProfesorQuery, [nombre, appaterno, apmaterno, newUserId], (err) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Error en el servidor', error: err });
        }

        res.status(201).json({ success: true, message: 'Profesor registrado con éxito' });
      });
    });
  });
});


// Ruta para obtener los grupos desde la base de datos
app.get('/datos', (req, res) => {
  const query1 = `
    SELECT 
      a.nombre AS asignatura, 
      e.nombre AS edificio, 
      au.nombre AS aula, 
      p.nombre AS profesor, 
      p.appaterno, 
      p.apmaterno, 
      p.dias_trabajo, 
      p.horainicio_trabajo, 
      p.horafin_trabajo, 
      p.calificación 
    FROM 
      asignaturas a 
    LEFT JOIN 
      profesores p ON CONVERT(a.nombre USING utf8mb4) = CONVERT(p.asignatura USING utf8mb4) 
    LEFT JOIN 
      aulas au ON p.id_profesor = au.id_aula 
    LEFT JOIN 
      edificios e ON au.id_edificio = e.id_edificio
  `;

  const query2 = `SELECT * FROM grupos`;

  const query3 = `SELECT * FROM asignaturas`;

  Promise.all([
    new Promise((resolve, reject) => {
      db.query(query1, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(query2, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(query3, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    })
  ])
  .then(([results1, results2, results3]) => {
    res.json({ Profesores: results1, Grupos: results2, Asignaturas: results3});
  })
  .catch(err => {
    res.status(500).send('Error en la consulta');
  });
});

// Endpoint para guardar horarios
app.post('/guardarHorarios', (req, res) => {
  const horarios = req.body;

  if (!horarios || horarios.length === 0) {
    return res.status(400).send('No se recibieron horarios para guardar.');
  }

  // Construcción de datos para la consulta
  const values = [];
  horarios.forEach(grupo => {
    grupo.horarios.forEach(({ hora, dias }) => {
      const [horaInicio, horaFin] = hora.split(' - ').map(h => `${h}:00`);
      dias.forEach(({ dia, asignatura, profesor, id_profesor, aula, edificio }) => {
        if (!asignatura || !profesor || !aula || !edificio) return; // Validar datos

        // Asegurarse de que `id_profesor` es un número entero válido
        const validIdProfesor = (id_profesor && !isNaN(id_profesor) && Number.isInteger(Number(id_profesor))) ? id_profesor : null;
        
        // Se inserta el nombre del profesor en la columna 'profesor' y el ID en 'id_profesor'
        values.push([grupo.id, asignatura, profesor, validIdProfesor, aula, dia, horaInicio, horaFin, edificio]);
      });
    });
  });

  if (values.length === 0) {
    return res.status(400).send('No se generaron datos válidos para guardar.');
  }

  // Consulta SQL
  const sql = `
    INSERT INTO horario (grupo, materia, profesor, id_profesor, aula, dia, hora_inicio, hora_fin, edificio)
    VALUES ?;
  `;

  db.query(sql, [values], (err, result) => {
    if (err) {
      console.error('Error al guardar horarios:', err);
      res.status(500).send('Error al guardar horarios.');
    } else {
      res.send('Horarios guardados exitosamente.');
    }
  });
});



// Ruta para obtener los grupos desde la base de datos
app.get('/datosPhorarios', (req, res) => {
  const query1 = `
    SELECT 
      a.nombre AS asignatura, 
      e.nombre AS edificio, 
      au.nombre AS aula,
      p.id_profesor, 
      p.nombre AS profesor, 
      p.appaterno, 
      p.apmaterno, 
      p.calificación 
    FROM 
      asignaturas a 
    LEFT JOIN 
      profesores p ON CONVERT(a.nombre USING utf8mb4) = CONVERT(p.asignatura USING utf8mb4) 
    LEFT JOIN 
      aulas au ON p.id_profesor = au.id_aula 
    LEFT JOIN 
      edificios e ON au.id_edificio = e.id_edificio
  `;

  const query2 = `SELECT * FROM grupos`;

  Promise.all([
    new Promise((resolve, reject) => {
      db.query(query1, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(query2, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    })
  ])
  .then(([results1, results2]) => {
    res.json({ Profesores: results1, Grupos: results2 });
  })
  .catch(err => {
    res.status(500).send('Error en la consulta');
  });
});

// Ruta para mostrar usuarios
app.get('/usuarios', (req, res) => {
  const query = 'SELECT * FROM usuarios';

  db.query(query, (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error in the server', error: err });
    }

    // Envía la respuesta con los resultados formateados
    res.status(200).json({
      success: true,   // Indica que la operación fue exitosa
      data: result     // Los datos de la tabla `usuarios`
    });
  });
});

app.post('/guardarRespuestas', (req, res) => {
  const { id_profesor, id_alumno, respuestas } = req.body;
  const fecha_respuesta = new Date();

  if (!id_alumno || !id_profesor || !Array.isArray(respuestas) || respuestas.length === 0) {
    return res.status(400).json({ success: false, message: 'Datos incompletos o inválidos' });
  }

  // Verificar si ya existen respuestas para el id_profesor e id_alumno
  const verificarConsulta = `
    SELECT COUNT(*) AS conteo
    FROM formulario
    WHERE id_profesor = ? AND id_alumno = ?
  `;

  db.query(verificarConsulta, [id_profesor, id_alumno], (err, results) => {
    if (err) {
      console.error('Error al verificar existencia:', err);
      return res.status(500).json({ success: false, message: 'Error al verificar datos existentes' });
    }

    const { conteo } = results[0];
    if (conteo > 0) {
      // Si ya hay respuestas, no ejecutar el `queries`
      return res.status(400).json({
        success: false,
        message: 'Ya existen respuestas registradas para este profesor y alumno.',
      });
    }

    // Si no hay respuestas previas, realizar las inserciones
    const queries = respuestas.map(({ pregunta_id, respuesta }) => {
      return new Promise((resolve, reject) => {
        const query = `
          INSERT INTO formulario (id_alumno, id_profesor, pregunta_id, respuesta, fecha_respuesta)
          VALUES (?, ?, ?, ?, ?)
        `;
        db.query(query, [id_alumno, id_profesor, pregunta_id, respuesta, fecha_respuesta], (err, result) => {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
              return reject(new Error('Ya se registraron calificaciones de ese profesor.'));
            }
            return reject(err);
          }
          resolve(result);
        });
      });
    });

    Promise.all(queries)
      .then(() => {
        res.status(200).json({ success: true, message: 'Respuestas guardadas con éxito' });
      })
      .catch((error) => {
        console.error('Error detallado de MySQL:', error);
        res.status(500).json({ success: false, message: 'Error al guardar respuestas', error: error.message });
      });
  });
});


// Ruta para mostrar datos de la tabla 'informe'
app.get('/profesores', (req, res) => {
  const query = 'SELECT * FROM profesores';  // Consulta SQL para obtener todos los registros de la tabla 'informe'

  db.query(query, (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error en el servidor', error: err });
    }

    // Envía la respuesta con los resultados formateados
    res.status(200).json({
      success: true,   // Indica que la operación fue exitosa
      data: result     // Los datos de la tabla 'informe'
    });
  });
});

app.post('/info-escuela', (req, res) => {
  const { asignatura, siglasAsignatura, aula, idEdificio, grupo } = req.body;

  // Verificar que todos los campos necesarios estén presentes
  if (!asignatura || !siglasAsignatura || !aula || !idEdificio || !grupo) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  // Inserción de asignatura con siglas
  const sqlAsignatura = 'INSERT INTO asignaturas (nombre, siglas) VALUES (?, ?)';
  db.query(sqlAsignatura, [asignatura, siglasAsignatura], (err, resultAsignatura) => {
    if (err) {
      console.error('Error al guardar asignatura:', err);
      return res.status(500).json({ error: 'Error al guardar la asignatura' });
    }

    const idAsignatura = resultAsignatura.insertId; // Obtener ID de la asignatura insertada

    // Verificar si el aula ya está registrada
    const sqlVerificarAula = 'SELECT id_aula FROM aulas WHERE nombre = ? AND id_edificio = ?';
    db.query(sqlVerificarAula, [aula, idEdificio], (err, resultAula) => {
      if (err) {
        console.error('Error al verificar aula:', err);
        return res.status(500).json({ error: 'Error al verificar el aula' });
      }

      if (resultAula.length > 0) {
        const idAula = resultAula[0].id_aula; // Aula existente
        guardarGrupo(idAula);
      } else {
        // Inserción de aula si no existe
        const sqlAula = 'INSERT INTO aulas (nombre, id_edificio) VALUES (?, ?)';
        db.query(sqlAula, [aula, idEdificio], (err, resultNuevaAula) => {
          if (err) {
            console.error('Error al guardar aula:', err);
            return res.status(500).json({ error: 'Error al guardar el aula' });
          }

          const idAula = resultNuevaAula.insertId; // Obtener ID de la nueva aula
          guardarGrupo(idAula);
        });
      }
    });

    // Función para guardar grupo asociado a la asignatura y aula
    const guardarGrupo = (idAula) => {
      // Verificar si el grupo ya existe
      const sqlVerificarGrupo = 'SELECT id_grupo FROM grupos WHERE nombre = ?';
      db.query(sqlVerificarGrupo, [grupo], (err, resultGrupo) => {
        if (err) {
          console.error('Error al verificar grupo:', err);
          return res.status(500).json({ error: 'Error al verificar el grupo' });
        }

        if (resultGrupo.length > 0) {
          const idGrupo = resultGrupo[0].id_grupo; // Grupo existente
          //asociarDatos(idAsignatura, idAula, idGrupo);
        } else {
          // Inserción de grupo si no existe
          const sqlGrupo = 'INSERT INTO grupos (nombre) VALUES (?)';
          db.query(sqlGrupo, [grupo], (err, resultNuevoGrupo) => {
            if (err) {
              console.error('Error al guardar grupo:', err);
              return res.status(500).json({ error: 'Error al guardar el grupo' });
            }

            const idGrupo = resultNuevoGrupo.insertId; // Obtener ID del nuevo grupo
            //asociarDatos(idAsignatura, idAula, idGrupo);
          });
        }
      });
    };
/*
    // Función para asociar los datos en la tabla correspondiente
    const asociarDatos = (idAsignatura, idAula, idGrupo) => {
      const sqlAsociacion = INSERT INTO relaciones (id_asignatura, id_aula, id_grupo) VALUES (?, ?, ?);
      db.query(sqlAsociacion, [idAsignatura, idAula, idGrupo], (err, resultRelacion) => {
        if (err) {
          console.error('Error al asociar datos:', err);
          return res.status(500).json({ error: 'Error al asociar los datos' });
        }

        res.json({ message: 'Información de la escuela guardada correctamente' });
      });
    };
    */
  });
});

// Nueva ruta para mostrar estadística de profesores
app.get('/estadistica', (req, res) => {
  const { correo } = req.query; // Obtener el correo desde los parámetros

  if (!correo) {
    return res.status(400).json({
      success: false,
      message: 'El correo es requerido',
    });
  }

  const query = `
    SELECT
      p.id_profesor,
      p.nombre,
      p.appaterno,
      p.apmaterno,
      COALESCE(AVG(f.respuesta), 0) AS promedio_puntuacion
    FROM profesores p
    LEFT JOIN formulario f ON p.id_profesor = f.id_profesor
    INNER JOIN usuarios u ON p.id_usuario = u.id
    WHERE u.correo = ? 
    GROUP BY p.id_profesor
    ORDER BY promedio_puntuacion DESC;
  `;

  db.query(query, [correo], (err, result) => { // Pasar el correo como parámetro
    if (err) {
      console.error('Error en la consulta:', err);
      return res.status(500).json({
        success: false,
        message: 'Error en el servidor',
        error: err,
      });
    }

    console.log('Estadística de profesores:', result);

    res.status(200).json({
      success: true,
      data: result,
    });
  });
});


// Traer id del usuario
app.post('/idusuario', (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).json({ success: false, message: 'Correo no proporcionado' });
  }

  const query = 'SELECT a.id_alumno FROM alumnos a JOIN usuarios u ON a.id_usuario = u.id WHERE u.correo = ?';

  db.query(query, [correo], (err, result) => {
    if (err) {
      console.error('Error en la consulta:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor', error: err });
    }

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    console.log('ID de Usuario:', result);

    res.status(200).json(result[0].id_alumno // Devuelve solo el ID
    );
  });
});

//Obtener horarios para profesores
app.post('/obtenerHorarios', (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).send('Correo no proporcionado.');
  }

  // Primera consulta para obtener el grupo basado en el correo
  const sqlGrupo = `
    SELECT 
      alumnos.id_grupo AS grupo 
    FROM 
      alumnos 
    JOIN 
      usuarios 
    ON 
      alumnos.id_usuario = usuarios.id 
    WHERE 
      usuarios.correo = ?;
  `;

  db.query(sqlGrupo, [correo], (err, results) => {
    if (err) {
      console.error('Error al obtener el grupo:', err);
      return res.status(500).send('Error al obtener el grupo.');
    }

    if (results.length === 0) {
      return res.status(404).send('No se encontró un grupo para el correo proporcionado.');
    }

    const grupo = results[0].grupo;

    // Segunda consulta para obtener los horarios del grupo
    const sqlHorarios = `SELECT 
        horario.grupo, 
        grupos.nombre AS nombre_grupo, 
        horario.materia, 
        horario.profesor, 
        horario.aula, 
        horario.dia, 
        horario.edificio, 
        TIME_FORMAT(horario.hora_inicio, '%H:%i') AS hora_inicio, 
        TIME_FORMAT(horario.hora_fin, '%H:%i') AS hora_fin
    FROM 
        horario
    JOIN 
        grupos ON grupos.id_grupo = horario.grupo
    WHERE 
        horario.grupo = ?
    ORDER BY 
        horario.grupo, 
        horario.dia, 
        horario.hora_inicio;

    `;

    db.query(sqlHorarios, [grupo], (err, horarios) => {
      if (err) {
        console.error('Error al obtener horarios:', err);
        return res.status(500).send('Error al obtener horarios.');
      }

      // Responder con los horarios en formato JSON
      res.json(horarios);
    });
  });
});

// Obtener horarios para profesores
app.post('/obtenerHorariosProfesores', (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).send('Correo no proporcionado.');
  }

  // Primera consulta para obtener el grupo basado en el correo
  const sqlGrupo = `
    SELECT correo, id_profesor 
    FROM usuarios 
    JOIN profesores 
    ON usuarios.id = profesores.id_usuario 
    WHERE correo = ?;
  `;

  db.query(sqlGrupo, [correo], (err, results) => {
    if (err) {
      console.error('Error al obtener el grupo:', err);
      return res.status(500).send('Error al obtener el grupo.');
    }

    if (results.length === 0) {
      return res.status(404).send('No se encontró un grupo para el correo proporcionado.');
    }

    // Imprimir el resultado de la consulta sqlGrupo en la consola
    console.log('Resultado de la consulta SQL para obtener grupo:', results);

    // Obtener el id_profesor desde el primer resultado
    const idProfesor = results[0].id_profesor;

    // Segunda consulta para obtener los horarios del profesor utilizando id_profesor
    const sqlHorarios = `
      SELECT 
      grupos.id_grupo, 
      grupos.nombre AS nombre_grupo, 
      horario.grupo, 
      horario.materia, 
      horario.profesor, 
      horario.aula, 
      horario.dia, 
      horario.edificio, 
      TIME_FORMAT(horario.hora_inicio, '%H:%i') AS hora_inicio, 
      TIME_FORMAT(horario.hora_fin, '%H:%i') AS hora_fin
  FROM 
      horario
  JOIN 
      grupos ON grupos.id_grupo = horario.grupo
  WHERE 
      horario.id_profesor = ?
  ORDER BY 
      horario.grupo, 
      horario.dia, 
      horario.hora_inicio;
    `;

    db.query(sqlHorarios, [idProfesor], (err, horarios) => {
      if (err) {
        console.error('Error al obtener horarios:', err);
        return res.status(500).send('Error al obtener horarios.');
      }

      // Responder con los horarios en formato JSON
      res.json(horarios);
    });
  });
});


// Endpoint para guardar peticiones
app.post('/guardarPeticiones', (req, res) => {
  const { id_profesor, diasDisponibles, horasTrabajo, tiempo_completo, fecha_peticion } = req.body;

  // Validar datos requeridos
  if (!id_profesor || !diasDisponibles || !horasTrabajo || typeof tiempo_completo !== 'boolean' || !fecha_peticion) {
    return res.status(400).send({ message: 'Datos incompletos o inválidos.' });
  }

  // Consulta SQL para insertar la petición
  const sql = `
    INSERT INTO peticiones (correo, dias_disponibles, horas_trabajo, tiempo_completo, fecha_peticion)
    VALUES (?, ?, ?, ?, ?);
  `;

  // Ejecutar la consulta
  db.query(
    sql,
    [id_profesor, diasDisponibles, horasTrabajo, tiempo_completo, fecha_peticion],
    (err, result) => {
      if (err) {
        console.error('Error al guardar la petición:', err);
        return res.status(500).send({ message: 'Error al guardar la petición.' });
      }
      res.send({ message: 'Petición guardada exitosamente.' });
    }
  );
});

app.post('/restricciones', (req, res) => {
  const { horaInicio, horaTermino, duracionClase, recesos } = req.body;

  if (!horaInicio || !horaTermino || !duracionClase || !recesos || recesos.length === 0) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  // Insertar restricciones en la tabla restricciones, ahora incluyendo la duración de la clase
  const sqlRestricciones = `
    INSERT INTO restricciones (hora_inicio, hora_termino, duracion_clase)
    VALUES (?, ?, ?)
  `;
  
  db.query(sqlRestricciones, [horaInicio, horaTermino, duracionClase], (err, result) => {
    if (err) {
      console.error('Error al guardar restricciones:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    const idRestriccion = result.insertId;  // ID de la restricción recién insertada

    // Insertar los recesos asociados a la restricción
    const recesosData = recesos.map((receso, index) => [
      idRestriccion,
      index + 1,
      receso.duracion,
      receso.horaInicio  // hora de inicio del receso
    ]);

    const sqlRecesos = `
      INSERT INTO recesos (id_restriccion, numero_receso, duracion, hora_inicio_receso)
      VALUES ?
    `;

    db.query(sqlRecesos, [recesosData], (err) => {
      if (err) {
        console.error('Error al guardar recesos:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }

      res.json({ message: 'Restricciones y recesos guardados correctamente' });
    });
  });
});


app.post('/info-escuela', (req, res) => {
  const { asignatura, siglasAsignatura, aula, idEdificio, grupo } = req.body;

  // Verificar que todos los campos necesarios estén presentes
  if (!asignatura || !siglasAsignatura || !aula || !idEdificio || !grupo) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  // Inserción de asignatura con siglas
  const sqlAsignatura = `INSERT INTO asignaturas (nombre, siglas) VALUES (?, ?)`;
  db.query(sqlAsignatura, [asignatura, siglasAsignatura], (err, resultAsignatura) => {
    if (err) {
      console.error('Error al guardar asignatura:', err);
      return res.status(500).json({ error: 'Error al guardar la asignatura' });
    }

    const idAsignatura = resultAsignatura.insertId; // Obtener ID de la asignatura insertada

    // Verificar si el aula ya está registrada
    const sqlVerificarAula = `SELECT id_aula FROM aulas WHERE nombre = ? AND id_edificio = ?`;
    db.query(sqlVerificarAula, [aula, idEdificio], (err, resultAula) => {
      if (err) {
        console.error('Error al verificar aula:', err);
        return res.status(500).json({ error: 'Error al verificar el aula' });
      }

      if (resultAula.length > 0) {
        const idAula = resultAula[0].id_aula; // Aula existente
        guardarGrupo(idAula);
      } else {
        // Inserción de aula si no existe
        const sqlAula = `INSERT INTO aulas (nombre, id_edificio) VALUES (?, ?)`;
        db.query(sqlAula, [aula, idEdificio], (err, resultNuevaAula) => {
          if (err) {
            console.error('Error al guardar aula:', err);
            return res.status(500).json({ error: 'Error al guardar el aula' });
          }

          const idAula = resultNuevaAula.insertId; // Obtener ID de la nueva aula
          guardarGrupo(idAula);
        });
      }
    });

    // Función para guardar grupo asociado a la asignatura y aula
    const guardarGrupo = (idAula) => {
      // Verificar si el grupo ya existe
      const sqlVerificarGrupo = `SELECT id_grupo FROM grupos WHERE nombre = ?`;
      db.query(sqlVerificarGrupo, [grupo], (err, resultGrupo) => {
        if (err) {
          console.error('Error al verificar grupo:', err);
          return res.status(500).json({ error: 'Error al verificar el grupo' });
        }

        if (resultGrupo.length > 0) {
          const idGrupo = resultGrupo[0].id_grupo; // Grupo existente
          //asociarDatos(idAsignatura, idAula, idGrupo);
        } else {
          // Inserción de grupo si no existe
          const sqlGrupo = `INSERT INTO grupos (nombre) VALUES (?)`;
          db.query(sqlGrupo, [grupo], (err, resultNuevoGrupo) => {
            if (err) {
              console.error('Error al guardar grupo:', err);
              return res.status(500).json({ error: 'Error al guardar el grupo' });
            }

            const idGrupo = resultNuevoGrupo.insertId; // Obtener ID del nuevo grupo
            //asociarDatos(idAsignatura, idAula, idGrupo);
          });
        }
      });
    };
/*
    // Función para asociar los datos en la tabla correspondiente
    const asociarDatos = (idAsignatura, idAula, idGrupo) => {
      const sqlAsociacion = `INSERT INTO relaciones (id_asignatura, id_aula, id_grupo) VALUES (?, ?, ?)`;
      db.query(sqlAsociacion, [idAsignatura, idAula, idGrupo], (err, resultRelacion) => {
        if (err) {
          console.error('Error al asociar datos:', err);
          return res.status(500).json({ error: 'Error al asociar los datos' });
        }

        res.json({ message: 'Información de la escuela guardada correctamente' });
      });
    };
    */
  });
});



app.post('/edificios', (req, res) => {
  const { nombre } = req.body;

  if (!nombre) {
      return res.status(400).json({ error: 'El nombre del edificio es obligatorio' });
  }

  const sql = 'INSERT INTO edificios (nombre) VALUES (?)';
  db.query(sql, [nombre], (err, result) => {
      if (err) {
          console.error('Error al guardar edificio:', err);
          return res.status(500).json({ error: 'Error al guardar el edificio' });
      }
      res.json({ message: 'Edificio agregado correctamente', id: result.insertId });
  });
});

app.get('/edificios', (req, res) => {
  const sql = 'SELECT id_edificio, nombre FROM edificios';
  db.query(sql, (err, results) => {
      if (err) {
          console.error('Error al obtener edificios:', err);
          return res.status(500).json({ error: 'Error al obtener edificios' });
      }
      res.json(results);
  });
});

app.post('/aulas', (req, res) => {
  const { nombre, id_edificio } = req.body;

  if (!nombre || !id_edificio) {
      return res.status(400).json({ error: 'El nombre del aula y el ID del edificio son obligatorios' });
  }

  const sql = 'INSERT INTO aulas (nombre, id_edificio) VALUES (?, ?)';
  db.query(sql, [nombre, id_edificio], (err, result) => {
      if (err) {
          console.error('Error al guardar aula:', err);
          return res.status(500).json({ error: 'Error al guardar el aula' });
      }
      res.json({ message: 'Aula agregada correctamente', id: result.insertId });
  });
});

// Ruta para obtener los horarios disponibles desde la base de datos
app.get('/obtenerhora', (req, res) => {
  const query = 'SELECT hora_inicio, hora_termino FROM restricciones';

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener los horarios:', err);
      res.status(500).send('Error al obtener los horarios');
      return;
    }

    // Formateamos los resultados en el formato solicitado
    const horariosDisponibles = results.map(row => ({
      startTime: row.hora_inicio,
      endTime: row.hora_termino
    }));

    res.json(horariosDisponibles);
  });
});

// Ruta para obtener los recesos de la escuela desde la base de datos
app.get('/obtenerrecesos', (req, res) => {
  const query = 'SELECT num_recesos, duracion_recesos FROM restricciones';

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener los horarios:', err);
      res.status(500).send('Error al obtener los horarios');
      return;
    }

    // Formateamos los resultados en el formato solicitado
    const recesosRecuperados = results.map(row => ({
      numRecesos: row.num_recesos,
      duracionRecesos: row.duracion_recesos
    }));

    res.json(recesosRecuperados);
  });
});


// Ruta para obtener las asignaturas desde la base de datos
app.get('/asignatura', (req, res) => {
  const query = 'SELECT id_asignatura, nombre FROM asignaturas';

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener las asignaturas:', err);
      res.status(500).send('Error al obtener las asignaturas');
      return;
    }

    // Enviamos las asignaturas como respuesta
    res.json(results);
  });
});

// Asignar asignatura a un profesor utilizando el correo
app.post('/enviarSignatura', (req, res) => {
  const { correo, asignatura } = req.body;

  if (!correo || !asignatura) {
    return res.status(400).send('Correo o asignatura no proporcionados.');
  }

  // Primera consulta: Obtener el id_profesor a partir del correo
  const sqlObtenerProfesor = `
    SELECT correo, id_profesor 
    FROM usuarios 
    JOIN profesores 
    ON usuarios.id = profesores.id_usuario 
    WHERE correo = ?;
  `;

  db.query(sqlObtenerProfesor, [correo], (err, results) => {
    if (err) {
      console.error('Error al obtener el id_profesor:', err);
      return res.status(500).send('Error al obtener el id_profesor.');
    }

    if (results.length === 0) {
      return res.status(404).send('No se encontró un profesor con el correo proporcionado.');
    }

    // Recuperar id_profesor del resultado
    const idProfesor = results[0].id_profesor;

    // Segunda consulta: Actualizar la asignatura para el profesor
    const sqlActualizarAsignatura = 'UPDATE profesores SET asignatura = ? WHERE id_profesor = ?';

    db.query(sqlActualizarAsignatura, [asignatura, idProfesor], (err, updateResults) => {
      if (err) {
        console.error('Error al asignar la asignatura:', err);
        return res.status(500).send('Error al asignar la asignatura.');
      }

      if (updateResults.affectedRows === 0) {
        return res.status(404).send('No se encontró un profesor para actualizar.');
      }

      // Respuesta exitosa
      res.json({ message: 'Asignatura asignada correctamente', id_profesor: idProfesor });
    });
  });
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
